# Les trois services d'Ardoise : Render, Neon, UptimeRobot

Ce document explique à quoi sert chaque service, comment ils s'emboîtent, et comment les
réutiliser pour un autre projet. Les limites gratuites cités sont ceux constatés en
novembre 2026 : **ils changent, vérifier sur les sites avant de s'engager**.

## 1. Le schéma d'ensemble

    Téléphone (app Ardoise)
            │  HTTPS
            ▼
      ┌───────────┐   connexion sécurisée   ┌───────────┐
      │  RENDER   │ ──────────────────────► │   NEON    │
      │  l'API    │                         │ la base   │
      └───────────┘                         └───────────┘
            ▲
            │ visite /health/ping toutes les 5 min
      ┌─────────────┐
      │ UPTIMEROBOT │ ──► e-mail si l'API ne répond plus
      └─────────────┘

Une app mobile ne peut pas parler directement à une base de données. Elle parle à une **API**
(un programme qui tourne en permanence sur un serveur), et c'est l'API qui lit et écrit dans la
**base de données**. D'où trois rôles distincts.

## 2. Render : le serveur qui fait tourner l'API

**À quoi ça sert.** Render héberge ton programme (l'API NestJS) sur un serveur allumé, avec une
adresse Internet en HTTPS (`https://ardoise-api-nf2c.onrender.com`). Sans lui, l'API ne
tournerait que sur ton PC, quand il est allumé.

**Ce qu'il fait pour toi.**
- Il lit ton dépôt GitHub, construit l'image Docker (`Dockerfile`) et lance l'API.
- À chaque nouvel envoi sur la branche `main`, il redéploie automatiquement.
- Il fournit le certificat HTTPS, les journaux (onglet *Logs*) et la gestion des variables
  secrètes (onglet *Environment*).
- Le fichier `render.yaml` (« Blueprint ») décrit le service : un fichier à la place de dizaines
  de clics.

**Les variables d'environnement.** Ce sont les réglages secrets (adresse de la base, clés
NotchPay, secret de connexion). Elles se saisissent dans Render, jamais dans le code. Le fichier
`.env` n'existe que sur ton PC.

**La limite à connaître (offre gratuite).** Après environ 15 minutes sans visite, Render met le
service en veille. Le réveil prend de l'ordre d'une minute. C'est pour ça qu'on ajoute
UptimeRobot. Les heures gratuites sont aussi partagées entre tous tes services gratuits.

**Quand payer.** Dès que de vrais clients paient : un plan payant évite la veille et donne plus
de mémoire (environ quelques dollars par mois, à vérifier).

**Pour un autre projet.**
1. Mettre le code sur GitHub.
2. Render : *New > Web Service* (ou *Blueprint* si tu as un `render.yaml`), choisir le dépôt.
3. Choisir la **région** la plus proche des utilisateurs *et* de la base.
4. Soit un `Dockerfile`, soit une commande de build et de démarrage (ex. `npm run build` puis
   `npm start`).
5. Saisir les variables d'environnement, définir le chemin de contrôle de santé.
6. Noter l'adresse attribuée : elle peut avoir un suffixe (`-nf2c`) si le nom est déjà pris.

## 3. Neon : la base de données PostgreSQL

**À quoi ça sert.** Neon stocke les données de façon durable : comptes, clients, dettes,
paiements, reçus. L'API est « sans mémoire » : si Render redémarre, tout ce qui n'est pas dans la
base est perdu. Neon, lui, garde les données.

**Ce qu'il fait pour toi.**
- Il héberge un PostgreSQL géré : pas de serveur à installer ni à mettre à jour.
- Il se met en veille quand personne ne l'utilise et se réveille en une seconde environ.
- Il offre des **branches** : une copie de la base pour tester une migration sans risque.
- Il fournit une **adresse de connexion** `postgresql://utilisateur:motdepasse@hôte/base`.
  Elle contient le mot de passe : à traiter comme un secret.

**Deux types d'adresse.** *Directe* (utile pour les migrations) et *poolée* (avec « pooler » dans
le nom de l'hôte, utile quand beaucoup de connexions arrivent). Ardoise utilise la directe.

**Les limites à connaître (offre gratuite).**
- Stockage plafonné (de l'ordre du gigaoctet).
- Le temps de calcul gratuit est limité par mois. Une base interrogée en permanence (par des
  visites régulières ou des tâches toutes les minutes) peut l'épuiser. Ardoise utilise donc
  `/health/ping`, qui ne touche pas la base, et coupe les tâches périodiques pendant le test
  fermé.
- L'historique de restauration est court (6 heures constatées sur ton écran). **Ce n'est pas
  une vraie sauvegarde.** Avant de gérer de l'argent réel, prévoir un plan avec sauvegardes plus
  longues, ou exporter régulièrement la base.

**Pour un autre projet.**
1. Neon : *New project*, région proche, version de PostgreSQL identique à celle des tests (ici
   la 16).
2. *Connect* : choisir la branche, décocher « Pooled connection », copier l'adresse.
3. La coller dans la variable `DATABASE_URL` du service Render.
4. Faire tourner les migrations au démarrage (`prisma migrate deploy` pour Ardoise).
5. Garder une base différente pour le développement (celle de ton PC) et pour la production.

## 4. UptimeRobot : le gardien

**À quoi ça sert.** UptimeRobot visite une adresse à intervalle régulier et te prévient par
e-mail si elle ne répond plus. Pour Ardoise, il a un second rôle utile : ses visites toutes les 5
minutes empêchent Render de mettre l'API en veille.

**Le piège évité.** L'adresse surveillée doit être légère. `/health` interroge la base à chaque
visite et empêcherait Neon de dormir ; on utilise donc `/health/ping`, qui répond sans toucher à
la base. Pour un contrôle complet occasionnel, utiliser `/health`.

**Limites (offre gratuite).** Visite au mieux toutes les 5 minutes, alertes par e-mail, pas de
contrôle du certificat SSL ni de plusieurs régions (réservés aux plans payants).

**Pour un autre projet.**
1. Ajouter dans l'API une route très légère de santé (ici `/health/ping`).
2. UptimeRobot : *Add New Monitor*, type HTTP(s), l'adresse de cette route, intervalle de 5
   minutes, notification par e-mail.
3. Ne pas utiliser cette astuce pour contourner la limite d'un plan : si le projet grossit,
   payer l'hébergement.

## 5. Check-list pour lancer un nouveau projet de la même façon

1. Code sur GitHub, avec un `Dockerfile`, un fichier `.env.example` et un `.gitignore` qui exclut
   `.env` et les clés de signature.
2. Neon : créer la base, copier l'adresse directe.
3. Render : créer le service, saisir les variables, choisir la même région que la base.
4. Ouvrir `/health` : la réponse doit être « ok ».
5. UptimeRobot : surveiller la route légère.
6. Tester l'app avec la vraie adresse avant de la distribuer.
7. Avant de gérer de l'argent réel : plan payant pour l'hébergeur, vraies sauvegardes de la base,
   journaux surveillés.

## 6. Où sont les secrets

| Secret | Où il vit |
|---|---|
| Adresse de la base (`DATABASE_URL`) | Neon, copiée dans Render (variable d'environnement) |
| Clés NotchPay, secret du webhook | NotchPay, copiés dans Render |
| Secret de connexion (`JWT_SECRET`) | Généré par Render |
| Clé de signature Android | Ton PC, dossier `ardoise-keys`, à sauvegarder |

Jamais dans GitHub, jamais dans une conversation.
