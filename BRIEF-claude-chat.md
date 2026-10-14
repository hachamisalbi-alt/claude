# Brief — Tableau de bord d'expédition Stallion Express (Medykare)

Tu vas construire pour moi une webapp interne en **Google Sheets + Apps Script**.
Je communique en français. Utilise **la direction artistique de nos autres apps**
(couleurs, typographie, composants) pour garder le même thème.

## Contexte

- Entreprise : Medykare, vente Amazon.ca FBM, expédition depuis **Montréal**.
- Transporteur : Stallion Express, API v5.
  - Production : `https://ship.stallion.ca/api/v5`
  - Sandbox : `https://sandbox.stallion.ca/api/v5`
  - Doc : https://docs.stallion.ca
- Destinations : **Canada uniquement**.
- Volume : ~500 envois/mois, pointes de 20 à 30/jour, en hausse.
- Historique : **on part de zéro** (aucun import d'envois passés).
- **Hors périmètre** : achat d'étiquettes, commandes Amazon, PDF, remontée du suivi vers Amazon.
  L'app ne fait **que lire** chez Stallion : aucun appel qui crée, achète, modifie ou annule.

## Avant de coder

1. Lis la doc v5, notamment : *Authentication & Scopes*, *Shipments*, *Tracking*,
   *Errors & Idempotency* (rate limits, erreurs) et la pagination des listes.
   Déjà connu : authentification par jeton Bearer ; pas de webhooks documentés,
   donc on interroge l'API à intervalles réguliers.
2. Repère les vrais noms des endpoints, des champs (coût, code postal, dates) et des
   codes d'événements de suivi. N'invente aucun format : s'il manque une info, demande-moi.
3. Tout se développe et se teste sur le **sandbox** avant la production.

## Sécurité du jeton

- Ne me demande **jamais** le jeton dans le chat.
- Il va dans les **Propriétés du script** (Extensions → Apps Script → Paramètres du projet) :
  `STALLION_API_TOKEN` et `STALLION_ENV` (`sandbox` ou `production`).
- Jamais dans une cellule de la feuille ni dans le code.
- Dis-moi à quel moment le remplir moi-même, et comment.

## Ce qu'on construit

1. **Collecte automatique toutes les 30 min** : tous mes envois Stallion et leurs
   événements de suivi, stockés dans la feuille avec l'historique complet.
2. **Webapp responsive** (ordinateur et mobile), servie par Apps Script (`doGet`) :
   - **Carte des zones** colorée par coût moyen réel : rouge foncé = plus cher,
     dégradé jaune → vert = moins cher.
   - **Délais de livraison réels** par zone, moyenne et médiane, calculés à partir des
     dates des événements de suivi (jamais des estimations).
   - **Vue 3D animée** (globe avec arcs depuis Montréal) colorée par statut.
   - **Liste filtrable** des envois en cours.

## Structure de la feuille

| Onglet | Contenu |
|---|---|
| `Envois` | 1 ligne par envoi : id Stallion, n° de suivi, transporteur, service, code postal, zone (3 premiers caractères), province, coût, statut, date de création, 1er scan, livraison, dernière mise à jour |
| `Evenements` | 1 ligne par événement : id envoi, date/heure, code, description, lieu. Sans doublons (clé = id envoi + date/heure + code + lieu) |
| `Zones` | calculé : par zone, nombre d'envois, coût moyen, délais moyen et médian (total et transporteur) |
| `Reglages` | intervalle de collecte, seuil minimum d'envois par zone (5 par défaut), etc. |
| `Journal` | chaque collecte : début, fin, nombre d'envois et d'événements traités, erreurs |

## Fonctions attendues

**Configuration**
- `setup()` : crée les onglets et les en-têtes, puis installe le déclencheur toutes les 30 min.
- `getConfig()` : lit le jeton et l'environnement dans les Propriétés du script.

**Appels à Stallion (lecture seule, GET uniquement)**
- `stallionGet(chemin, paramètres)` : appel authentifié ; en cas d'erreur 429 ou 5xx, nouvelles
  tentatives avec attente croissante (2 s, 4 s, 8 s, 16 s) en respectant `Retry-After`.
- `fetchShipments(depuis)` : envois créés ou modifiés depuis la dernière collecte, page par page.
- `fetchTracking(envoi)` : événements de suivi d'un envoi.

**Collecte**
- `syncAll()` : lancée par le déclencheur. Garde un curseur (dernière collecte) et
  s'arrête proprement avant la limite de 6 min d'Apps Script pour reprendre au tour suivant.
  Un verrou (`LockService`) empêche deux collectes en même temps.
- `upsertShipment(envoi)` : ajoute un envoi ou met à jour sa ligne.
- `appendEvents(envoi, événements)` : n'ajoute que les nouveaux événements.
- `computeStatus(événements)` : classe l'envoi dans l'un des 4 statuts ci-dessous.
- `refreshZones()` : recalcule l'onglet `Zones`.
- Écritures groupées (`setValues`) plutôt que cellule par cellule.

**Calculs**
- `fsaOf(codePostal)` : zone = 3 premiers caractères d'un code postal canadien valide
  (`H3B 4W8` → `H3B`), `null` si le code est invalide.
- `deliveryDays(envoi)` : deux délais, en **jours calendaires et en jours ouvrables** :
  - délai total = de la création de l'étiquette à la livraison ;
  - délai transporteur = du 1er scan à la livraison.
- `zoneStats()` : par zone, nombre d'envois, coût moyen, et moyenne et médiane des délais.
  Les zones sous le seuil minimum d'envois sont signalées comme peu fiables.
  Fuseau horaire : `America/Toronto`.

**Webapp**
- `doGet()` : affiche la page.
- `getDashboardData()` : zones, envois et compteurs par statut.
- `getShipments(filtres)` : filtres par statut, zone, province, transporteur et période.
- Côté page :
  - carte par zone de code postal avec MapLibre, à partir du fichier de limites des RTA
    de Statistique Canada, simplifié pour rester léger ;
  - globe 3D avec arcs animés depuis Montréal, colorés par statut (globe.gl) ;
  - tableau filtrable ;
  - filtre et légende par **transporteur** sur la carte et les délais.
- Accès limité à mon compte Google.

## Les 4 statuts

| Statut | Règle |
|---|---|
| Dans mon entrepôt | étiquette créée, aucun scan |
| Chez Stallion | scanné dans un centre Stallion, pas encore remis au transporteur final |
| En transit | scanné par le transporteur, pas encore livré |
| Livré | événement « livré » reçu |

La correspondance exacte avec les codes d'événements Stallion est à confirmer dans la doc v5.

## Livrables

1. La Google Sheet créée avec ses onglets.
2. Le code Apps Script complet et commenté.
3. Les étapes pour moi : où mettre le jeton, lancer `setup()`, autoriser le script,
   déployer la webapp et ouvrir le lien sur mobile.
4. Un test sur le sandbox avec le résultat réel, avant de passer en production.

Commence par me confirmer ta compréhension et poser tes questions avant de coder.
