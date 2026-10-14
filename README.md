# Medykare — Expédition Stallion Express

Application interne : lot du jour d'étiquettes pour les commandes Amazon.ca FBM,
collecte du suivi, tableau de bord coûts / délais réels. Hébergement gratuit sur Cloudflare.
Plan détaillé : [PLAN.md](PLAN.md).

## Développement local

```bash
npm install
npm run db:migrate:local   # crée la base SQLite locale
npm run dev                # http://localhost:8787
npm test
```

Le jeton Stallion se met dans `.env` (jamais commité) :

```
STALLION_API_TOKEN=
STALLION_ENV=sandbox
```

## Mise en ligne (Cloudflare, gratuit)

```bash
npx wrangler login
npx wrangler d1 create medykare          # copier l'id dans wrangler.toml
npm run db:migrate:remote
npx wrangler secret put STALLION_API_TOKEN
npm run deploy
```

Protéger l'accès avec Cloudflare Access (gratuit) : Zero Trust → Access → Applications,
autoriser uniquement votre adresse e-mail.

## Flux quotidien

1. Seller Central → Commandes → Rapports de commandes → **Commandes non expédiées** → télécharger.
2. Téléverser le fichier dans l'app → **Lot du jour** (commandes avant la coupure, 23 h par défaut).
3. Vérifier les boîtes 8x8x8 (multi-articles), comparer les tarifs, confirmer le coût total.
4. Imprimer le PDF 4x6 unique, trié par SKU.
5. Téléverser le fichier de **confirmation d'expédition** généré dans Seller Central.

## API actuelle

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/health` | État, environnement Stallion, jeton configuré ou non |
| GET | `/api/settings` | Coupure, transporteur préféré, boîtes |
| PUT | `/api/settings/:key` | Modifier `cutoff_time`, `preferred_carrier`, `box_single`, `box_multi` |
| POST | `/api/orders/import` | Import du rapport Seller Central (TSV brut) |
| GET | `/api/lot` | Lot du jour avec boîte proposée |
