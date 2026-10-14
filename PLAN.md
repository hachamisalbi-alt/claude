# Medykare — Application d'expédition Stallion Express

Application interne : étiquettes en lot pour les commandes Amazon.ca FBM expédiées
depuis Montréal, collecte continue du suivi, tableau de bord coûts / délais réels.

> **État de la lecture de la doc v5** : docs.stallion.ca n'est pas joignable depuis
> l'environnement de développement (réseau bloqué). Ce qui est confirmé vient de
> l'index public de la doc ; ce qui est marqué **[à vérifier]** sera validé dès que
> l'accès à `docs.stallion.ca` et `sandbox.stallion.ca` sera ouvert.

## Réponses du client (14/10/2026)

| Sujet | Réponse | Conséquence |
|---|---|---|
| Hébergement | En ligne, gratuit (Google Sheets envisagé) | Voir « Hébergement » ci-dessous |
| Historique | Départ à zéro | Pas d'import ; la collecte démarre au 1er envoi |
| Volume | ~500 étiquettes/mois, pointes 20–30/jour, en hausse | Les quotas gratuits suffisent largement |
| Destinations | Canada uniquement | Pas de douane ; zones = RTA (3 premiers caractères du code postal) |
| Amazon ↔ Stallion | **Non connecté, et ne doit pas l'être** | Commandes et remontée du suivi gérées par l'app (voir ci-dessous) |
| Imprimante | Comer 4x6 thermique | Étiquettes PDF 4x6, un seul PDF fusionné |
| Service | Intelcom par défaut, sinon le moins cher | Règle : Intelcom si disponible, sinon le moins cher ; les deux prix affichés |
| Colis | 1 article → boîte 8x6x4 po ; plusieurs → 8x8x8 po **avec confirmation** | Plus de fiche par SKU : 2 profils de boîte ; poids par défaut à préciser |
| Coupure du jour | 23 h, modifiable | Paramètre dans l'écran Réglages |

## Source des commandes Amazon (sans connexion Stallion)

1. **Étape 1 — import de fichier (aucune approbation)** : téléversement du rapport
   « Commandes non expédiées » de Seller Central (TSV, contient l'adresse de livraison FBM).
   Remontée du suivi : l'app génère le fichier « Confirmation d'expédition » à
   téléverser dans Seller Central (*Commandes → Téléverser des fichiers liés aux commandes*).
2. **Étape 2 — automatisation SP-API (optionnelle)** : application privée auto-autorisée.
   Demande le rôle restreint *Direct-to-Consumer Shipping* pour les adresses (revue Amazon,
   délai de quelques jours à semaines) et oblige à respecter la *Data Protection Policy*
   d'Amazon (chiffrement, effacement des adresses 30 jours après livraison).
   Remontée du suivi via `confirmShipment`. **[à vérifier : code transporteur Intelcom accepté par Amazon.ca]**

## Hébergement

- **Recommandé : Cloudflare (gratuit)** — Workers (API + job planifié par *Cron Trigger*),
  D1 (base SQLite), Pages (webapp), Cloudflare Access (connexion protégée par e-mail).
  Jeton en *secret* Cloudflare. Bonus : export automatique vers une Google Sheet en lecture.
- **Alternative : Google Apps Script + Google Sheets (gratuit)** — Sheets comme base,
  déclencheur toutes les 30 min, webapp HtmlService. Limites : 6 min par exécution,
  webapp lente sur mobile, fusion PDF côté navigateur, carte 3D plus fragile.

## Ce que dit la doc v5 (confirmé)

- v5 = API recommandée pour les nouvelles intégrations : tarifs, envois, étiquettes,
  ramassages, suivi, commandes, données douanières produits.
- Base URLs : `https://ship.stallion.ca/api/v5` (prod), `https://sandbox.stallion.ca/api/v5` (sandbox).
- Authentification par jeton *Bearer* avec un modèle de *scopes* (page « Authentication & Scopes »).
- Achat d'étiquette : `POST /labels/{shipment_id}` avec le `service` choisi → débite le solde de crédit.
- En-tête `Idempotency-Key` supporté sur les requêtes mutantes (page « Errors & Idempotency »).
- Lots : un endpoint *process* achète les étiquettes de tous les envois valides du lot,
  répond tout de suite `{"status":"processing"}` ; on interroge `GET /batches/{id}`
  jusqu'à la fin, et les échecs sont listés via l'endpoint d'erreurs du lot.
- Sections de référence : Rates, Shipments, Labels, Batches, Tracking, Orders, Products.
- Pas de section *webhooks* visible → le suivi se fait par interrogation périodique (polling).

## Décisions d'architecture

| Sujet | Choix | Pourquoi |
|---|---|---|
| Source des commandes | Import du rapport Seller Central, puis SP-API en option | Store Amazon non connecté à Stallion (choix du client). |
| Remontée du suivi vers Amazon | Fichier de confirmation généré par l'app, puis SP-API en option | Stallion ne peut pas le faire sans connexion du store. |
| Idempotence | Clé déterministe `mdk-label-{order_id}-v{n}` + machine à états en base avec contrainte d'unicité | Une relance (réseau, double clic, crash) renvoie la même clé → Stallion ne rachète pas. `n` ne s'incrémente que sur annulation (void) explicite. |
| Achat en lot | `batches` v5 (création → process → polling) | Un seul appel d'achat, erreurs par envoi. Repli : `POST /labels/{id}` un par un avec clé d'idempotence. |
| Garde-fou d'achat | Écran de confirmation : nb d'étiquettes, coût total, solde Stallion restant ; bouton désactivé tant que la saisie n'est pas confirmée | Aucun achat implicite. |
| PDF | Téléchargement de chaque étiquette 4x6 → fusion `pdf-lib` triée par SKU (puis n° commande) | Un seul fichier à imprimer. |
| Collecte | Job planifié (45 min par défaut) : liste des envois modifiés + événements de suivi, stockage *append-only* | Historique complet, dédoublonné par (envoi, horodatage, code, lieu). |

## Stack proposée

- **Langage** : TypeScript partout (un seul langage back/front).
- **Back-end** : Cloudflare Workers (Hono), client Stallion typé (zod) avec retries + backoff respectant le *rate limit*.
- **Base** : Cloudflare D1 (SQLite) via Drizzle ORM.
- **Planificateur** : Cloudflare Cron Trigger (toutes les 45 min).
- **Front** : React + Vite + Tailwind, responsive mobile-first.
- **Carte 2D** : MapLibre GL, choroplèthe par RTA (fichier de limites Statistique Canada, simplifié),
  échelle vert → jaune → rouge foncé.
- **3D** : deck.gl `GlobeView` + `ArcLayer`/`TripsLayer` animés depuis Montréal, couleur par statut.
- **Tests** : Vitest + mocks HTTP (msw) puis tests d'intégration sur le **sandbox**.

## Modèle de données (simplifié)

- `box_profiles` (single 8x6x4 po, multi 8x8x8 po, poids par défaut) + `sku_overrides` optionnels
- `orders` (id Amazon, id Stallion, date, destinataire, lignes SKU, statut)
- `label_purchases` (order_id UNIQUE actif, idempotency_key UNIQUE, état
  `draft → quoted → confirmed → purchasing → purchased | failed | voided`, service, coût, tracking, pdf)
- `rate_quotes` (order_id, service, prix, délai estimé, horodatage)
- `shipments` (id Stallion, tracking, zone, coût réel, statut courant, dates clés)
- `tracking_events` (shipment_id, horodatage, code, description, lieu — UNIQUE sur la combinaison)
- `sync_runs` (début, fin, nb envois/événements, erreurs)

## Statuts pour la vue 3D

| Statut app | Règle |
|---|---|
| Dans mon entrepôt | étiquette créée, aucun scan |
| Chez Stallion | 1er scan à un centre Stallion, pas encore remis au transporteur final |
| En transit | scan transporteur après remise, non livré |
| Livré | événement *delivered* |

(Correspondance exacte avec les codes d'événements v5 **[à vérifier]**.)

## Délais réels

Calculés uniquement à partir des horodatages des événements :
- **Délai total** = livraison − création de l'étiquette
- **Délai transporteur** = livraison − 1er scan
Moyenne et médiane par zone, en jours ouvrables et calendaires ; les zones avec < 5 envois sont signalées.

## Plan par étapes

0. **Fondations** — repo, `.env`, client Stallion v5, lecture complète de la doc,
   vérification des scopes du jeton sur le sandbox.
1. **Profils de boîte & réglages** — 8x6x4 / 8x8x8, poids, heure de coupure (23 h).
2. **Lot du jour (lecture seule)** — import du rapport Seller Central, commandes avant la coupure,
   boîte pré-remplie (confirmation pour les multi-articles), tarifs comparés, Intelcom sinon le moins cher.
3. **Achat en lot (sandbox)** — confirmation + coût total, idempotence, batch, PDF fusionné trié par SKU.
   Tests : double clic, coupure réseau pendant l'achat, relance du process → jamais de double achat.
4. **Remontée Amazon** — fichier de confirmation d'expédition ; SP-API ensuite si souhaité.
5. **Bascule production** — 1 commande réelle, puis lot complet.
6. **Collecte continue** — job planifié (pas d'historique à importer).
7. **Webapp analytique** — carte des coûts, délais réels, liste filtrable des envois.
8. **Vue 3D animée** par statut.
9. **Mise en ligne** sur l'hébergement retenu.

## Configuration

Remplir `.env` (jamais commité) :

```
STALLION_API_TOKEN=
STALLION_ENV=sandbox
```
