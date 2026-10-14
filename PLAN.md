# Medykare — Application d'expédition Stallion Express

Application interne : étiquettes en lot pour les commandes Amazon.ca FBM expédiées
depuis Montréal, collecte continue du suivi, tableau de bord coûts / délais réels.

> **État de la lecture de la doc v5** : docs.stallion.ca n'est pas joignable depuis
> l'environnement de développement (réseau bloqué). Ce qui est confirmé vient de
> l'index public de la doc ; ce qui est marqué **[à vérifier]** sera validé dès que
> l'accès à `docs.stallion.ca` et `sandbox.stallion.ca` sera ouvert.

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
| Source des commandes | **Commandes importées dans Stallion (API v5 Orders)** | Évite SP-API : l'adresse acheteur Amazon est une donnée PII qui exige un profil développeur approuvé + *Restricted Data Token*. Stallion a déjà ce droit via l'intégration du store. SP-API seulement en repli. |
| Remontée du suivi vers Amazon | Stallion le fait pour les commandes du store **[à vérifier : aussi quand l'étiquette est achetée via l'API]** | Test sandbox/prod sur 1 commande avant généralisation. Repli : `confirmShipment` SP-API. |
| Idempotence | Clé déterministe `mdk-label-{order_id}-v{n}` + machine à états en base avec contrainte d'unicité | Une relance (réseau, double clic, crash) renvoie la même clé → Stallion ne rachète pas. `n` ne s'incrémente que sur annulation (void) explicite. |
| Achat en lot | `batches` v5 (création → process → polling) | Un seul appel d'achat, erreurs par envoi. Repli : `POST /labels/{id}` un par un avec clé d'idempotence. |
| Garde-fou d'achat | Écran de confirmation : nb d'étiquettes, coût total, solde Stallion restant ; bouton désactivé tant que la saisie n'est pas confirmée | Aucun achat implicite. |
| PDF | Téléchargement de chaque étiquette 4x6 → fusion `pdf-lib` triée par SKU (puis n° commande) | Un seul fichier à imprimer. |
| Collecte | Job planifié (45 min par défaut) : liste des envois modifiés + événements de suivi, stockage *append-only* | Historique complet, dédoublonné par (envoi, horodatage, code, lieu). |

## Stack proposée

- **Langage** : TypeScript partout (un seul langage back/front).
- **Back-end** : Node 22 + Fastify, client Stallion typé (zod) avec retries + backoff respectant le *rate limit*.
- **Base** : SQLite (local) ou PostgreSQL (en ligne) via Drizzle ORM — même schéma.
- **Planificateur** : `node-cron` dans le process serveur (local) ou cron de l'hébergeur (en ligne).
- **Front** : React + Vite + Tailwind, responsive mobile-first.
- **Carte 2D** : MapLibre GL, choroplèthe par zone (provinces/FSA au Canada, États/ZIP3 aux US),
  échelle vert → jaune → rouge foncé.
- **3D** : deck.gl `GlobeView` + `ArcLayer`/`TripsLayer` animés depuis Montréal, couleur par statut.
- **Tests** : Vitest + mocks HTTP (msw) puis tests d'intégration sur le **sandbox**.

## Modèle de données (simplifié)

- `sku_profiles` (sku, poids, L×l×h, emballage, valeur/douane, HS code)
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
1. **Fiches SKU** — import CSV/édition des poids/dimensions.
2. **Lot du jour (lecture seule)** — récupération des commandes Amazon.ca FBM du jour,
   pré-remplissage SKU, comparaison des tarifs, service le moins cher pré-sélectionné.
3. **Achat en lot (sandbox)** — confirmation + coût total, idempotence, batch, PDF fusionné trié par SKU.
   Tests : double clic, coupure réseau pendant l'achat, relance du process → jamais de double achat.
4. **Remontée Amazon** — vérifier le comportement automatique de Stallion ; sinon SP-API.
5. **Bascule production** — 1 commande réelle, puis lot complet.
6. **Collecte continue** — job planifié + import de l'historique.
7. **Webapp analytique** — carte des coûts, délais réels, liste filtrable des envois.
8. **Vue 3D animée** par statut.
9. **Hébergement** selon votre choix.

## Configuration

Remplir `.env` (jamais commité) :

```
STALLION_API_TOKEN=
STALLION_ENV=sandbox
```
