# Mettre l'API L'Ardoise en ligne

L'API se déploie comme une image Docker (voir `Dockerfile` à la racine) avec une base
PostgreSQL 16. Elle fonctionne chez n'importe quel hébergeur qui sait lancer un conteneur.

## 0. Parcours gratuit pour le test fermé (Render + Neon + UptimeRobot)

À vérifier sur leurs sites : les offres gratuites changent.

1. **Neon** (base PostgreSQL gratuite) : créer un projet PostgreSQL 16 et copier l'adresse de
   connexion (`postgresql://…?sslmode=require`).
2. **Render** : se connecter avec GitHub, *New > Blueprint*, choisir ce dépôt (le fichier
   `render.yaml` décrit le service). Renseigner `DATABASE_URL` (Neon), `NOTCHPAY_PUBLIC_KEY`
   (`pk_test_…`) et `OTP_TEST_NUMBERS` (testeurs). `JWT_SECRET` et `WEBHOOK_SECRET` sont générés.
3. Une fois déployé, ouvrir `https://<nom>.onrender.com/health`. Si le nom n'est pas
   `ardoise-api`, corriger `PUBLIC_PAY_URL`.
4. **UptimeRobot** (gratuit) : surveiller `/health/ping` (et **pas** `/health`, qui interroge la
   base et l'empêcherait de se mettre en veille) toutes les 5 minutes. Sans cela, l'offre
   gratuite de Render met l'API en veille après 15 minutes d'inactivité : le premier appel
   prend alors une minute et l'app affiche « Le serveur ne répond pas ». Les tâches de
   rattrapage des paiements ne tournent pas non plus pendant la veille.
5. Créer le webhook NotchPay sur `https://<nom>.onrender.com/webhooks/payments`, puis remplacer
   `WEBHOOK_SECRET` par son secret `hsk_…`.

**Limites de ce parcours :** adapté à quelques dizaines de testeurs, pas à de vrais paiements
en volume. Avant l'ouverture au public, passer à un plan payant (ou un petit serveur) et
sauvegarder la base.

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

## 6. Codes de connexion (SMS)

L'app se connecte par numéro de téléphone + code à 6 chiffres. En production, l'API **refuse
de démarrer** s'il n'y a aucun moyen d'envoyer ou d'accepter un code. Deux mécanismes :

**a) Numéros de test à code fixe (gratuit)** — phase de test fermé Google, relecteur Google :

    OTP_TEST_NUMBERS=+237600000001:123456,+237600000002:654321

Ces numéros se connectent avec le code indiqué, sans SMS. Les autres numéros ne reçoivent
rien tant qu'aucun fournisseur SMS n'est configuré (le code n'est alors pas écrit dans les
logs). N'y mettre que des numéros de testeurs, avec des codes que vous changez régulièrement.

**b) Vrai envoi de SMS (Africa's Talking)** — pour l'ouverture au public :

    SMS_PROVIDER=africastalking
    AT_USERNAME=<identifiant du compte>
    AT_API_KEY=<clé API>
    AT_SENDER_ID=<nom d'expéditeur, optionnel et soumis à validation>

L'adaptateur est écrit d'après la documentation du fournisseur et testé avec des réponses
simulées : **valider avec un premier envoi réel** (compte de test du fournisseur, variable
`AT_BASE_URL` pour son adresse sandbox) avant l'ouverture au public.

**Piste ultérieure :** code par e-mail (offres gratuites des services d'e-mail), à ajouter
comme second moyen de connexion.

## 7. Base de données

Une base PostgreSQL gérée avec sauvegardes automatiques est recommandée (l'argent des clients
y est enregistré). Ne pas utiliser une base qui expire ou qui est effacée au bout de quelques
semaines.
