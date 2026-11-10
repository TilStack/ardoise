# Mettre l'API L'Ardoise en ligne

L'API se déploie comme une image Docker (voir `Dockerfile` à la racine) avec une base
PostgreSQL 16. Elle fonctionne chez n'importe quel hébergeur qui sait lancer un conteneur.

## 1. Ce qu'il faut

| Élément | Rôle |
|---|---|
| Hébergeur de conteneur | fait tourner l'API (port 3000, HTTPS fourni par l'hébergeur) |
| PostgreSQL 16 | base de données (voir « Base de données ») |
| Adresse HTTPS publique | ex. `https://ardoise-api.exemple.com` : sert à l'app, aux liens de paiement et au webhook NotchPay |
| Fournisseur SMS | envoi des codes de connexion (**obligatoire**, voir plus bas) |
| Compte NotchPay vérifié | clés de **production** |

## 2. Variables d'environnement à définir chez l'hébergeur

À saisir dans l'interface de l'hébergeur, jamais dans le dépôt.

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` (déjà dans l'image) |
| `DATABASE_URL` | URL de la base, avec `?sslmode=require` si l'hébergeur de base l'impose |
| `JWT_SECRET` | chaîne aléatoire de 32 caractères minimum |
| `PAYMENT_PROVIDER` | `notchpay` (`sandbox` est refusé en production) |
| `NOTCHPAY_PUBLIC_KEY` | clé publique de production (`pk_…`) |
| `WEBHOOK_SECRET` | secret du webhook NotchPay de production (`hsk_…`) |
| `PUBLIC_PAY_URL` | `https://<votre-adresse>/p` |
| `ENABLE_JOBS` | `true` (rattrapage des paiements, relances) |
| `OTP_DEV_ECHO` | ne pas définir (refusé en production) |

Générer un `JWT_SECRET` : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## 3. Au démarrage

Le conteneur applique les migrations (`prisma migrate deploy`) puis lance l'API.
Contrôle : `GET https://<votre-adresse>/health` répond `{"status":"ok"}`.

## 4. NotchPay en production

1. Faire vérifier le compte NotchPay, puis passer en mode Production.
2. Reprendre les clés de production dans les variables ci-dessus.
3. Créer le webhook `https://<votre-adresse>/webhooks/payments` (événements
   `payment.complete`, `payment.failed`, `payment.canceled`, `payment.expired`) et copier son
   secret dans `WEBHOOK_SECRET`.
4. Faire un premier paiement réel de faible montant pour vérifier le webhook.

## 5. Application mobile

Compiler avec l'adresse de production :

    flutter build appbundle --release --dart-define=API_URL=https://<votre-adresse>

## 6. Envoi de SMS : point bloquant

Le seul envoi de SMS actuel est `console`, qui écrit le code dans les logs. En production,
personne ne recevrait son code de connexion. Il faut brancher un vrai fournisseur (Africa's
Talking, Orange, Twilio, etc.) dans `apps/api/src/auth/auth.ts` (classe `SmsSender`) avant
l'ouverture au public.

## 7. Base de données

Une base PostgreSQL gérée avec sauvegardes automatiques est recommandée (l'argent des clients
y est enregistré). Ne pas utiliser une base qui expire ou qui est effacée au bout de quelques
semaines.
