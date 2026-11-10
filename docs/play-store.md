# Fiche Google Play : tout ce qu'il faut saisir

À copier-coller dans la Play Console. Les limites de Google (titre 30 caractères, description
courte 80, description longue 4 000) sont respectées.

## 1. Informations de base

| Champ | Valeur |
|---|---|
| Nom de l'application | Ardoise |
| Type | Application (pas un jeu), gratuite |
| Langue par défaut | Français (Cameroun si proposé, sinon France) |
| Catégorie | Finance (ou « Outils professionnels » si Finance déclenche trop de questions) |
| Adresse e-mail de contact | celle que tu lis (publique sur la fiche) |
| Politique de confidentialité | adresse web publique de `docs/politique-confidentialite.html` |

## 2. Description courte (70 caractères)

    Notez qui vous doit de l'argent et encaissez par MoMo ou Orange Money.

## 3. Description longue

    Ardoise remplace le cahier de crédit. Notez en quelques secondes ce qu'on vous doit, envoyez
    un lien de paiement et suivez qui a payé.

    POUR QUI ?
    • Les boutiquiers qui vendent à crédit.
    • Toute personne qui a prêté de l'argent à des proches ou à des connaissances, avec un mode
      « Particulier » aux mots adaptés.

    CE QUE VOUS POUVEZ FAIRE
    • Ajouter une personne et noter une dette ou un remboursement en quelques touches.
    • Voir d'un coup d'œil le total qu'on vous doit et le solde de chaque personne.
    • Envoyer un lien de paiement par WhatsApp ou par SMS. La personne paie par MTN MoMo ou Orange
      Money, même une partie seulement.
    • Recevoir la confirmation du paiement et un reçu, sans avoir à vérifier à la main.
    • Garder l'historique : rien n'est jamais effacé, les erreurs se corrigent par une nouvelle écriture.
    • Travailler sans connexion : vos saisies sont enregistrées sur le téléphone et envoyées dès
      que le réseau revient.
    • Choisir le thème clair ou sombre.

    VOS DONNÉES
    • Pas de publicité, pas de suivi.
    • Vous pouvez supprimer votre compte et vos données à tout moment depuis l'écran Profil.

    Ardoise est conçue pour le Cameroun : numéros camerounais, FCFA, MTN MoMo et Orange Money.

## 4. Visuels

| Visuel | Fichier | État |
|---|---|---|
| Icône 512×512 | `apps/mobile/assets/logo/play_icon_512.png` | prête |
| Image de présentation 1024×500 | `apps/mobile/assets/logo/play_feature_1024x500.png` | prête |
| Captures d'écran téléphone (2 à 8, 16:9 ou 9:16) | à faire sur le Pixel 6 | à faire |

**Captures à prendre** (compte de démonstration avec 3 ou 4 personnes fictives, pas de vrais
noms) : écran d'accueil du choix de profil ; tableau de bord ; liste des personnes ; fiche d'une
personne avec son historique ; page de paiement ; écran Profil. Une partie en thème sombre.

## 5. Formulaires de la console (brouillon de réponses)

À vérifier au moment de remplir : les questions de Google évoluent.

- **Public visé** : 18 ans et plus.
- **Publicités** : l'app ne contient pas de publicité.
- **Accès à l'application** : l'app demande une connexion. Fournir au relecteur un **numéro de test
  et son code fixe** (voir section 6). Les instructions doivent être complètes.
- **Sécurité des données** :
  - collectées : numéro de téléphone, nom, informations de paiement (montants, opérateur,
    numéro qui paie), contenu saisi par l'utilisateur (libellés de dettes) ;
  - partagées avec : le prestataire de paiement et l'hébergeur (traitement pour le service) ;
  - chiffrées en transit : oui (HTTPS) ;
  - suppression : l'utilisateur peut demander la suppression (dans l'app et par e-mail).
- **Services financiers** : l'app ne prête pas d'argent, ne propose pas de crédit et ne donne pas
  de conseil financier. Elle aide à noter des dettes entre personnes et à encaisser par mobile
  money via un prestataire de paiement. Lire la déclaration de Google sur les services
  financiers et répondre en conséquence.
- **Classification du contenu** : pas de violence, pas de contenu sexuel, pas de jeu d'argent.

## 6. Accès pour le relecteur de Google

1. Choisir un numéro dédié, par exemple `+237600000099`, et un code à 6 chiffres (pas
   `123456`).
2. Dans Render, ajouter cette entrée à `OTP_TEST_NUMBERS` : `+237600000099:<code>`.
3. Dans la console, rubrique « Accès à l'application », écrire :

       Connexion par numéro de téléphone.
       1. Ouvrir l'app, choisir « Pour ma boutique ».
       2. Saisir le numéro 600000099.
       3. Saisir le code : <code>.
       Aucun SMS n'est nécessaire pour ce compte de test.

4. Une fois la publication validée, retirer ce numéro de la variable.

## 7. Message d'invitation pour les testeurs

À envoyer par WhatsApp à chaque testeur (adapter les crochets) :

    Bonjour [prénom],
    Je teste mon application Ardoise (un carnet de dettes pour boutiquiers). Tu peux m'aider ?
    Il suffit de l'installer et de l'ouvrir de temps en temps pendant 14 jours.

    1. Utilise un téléphone Android avec ton compte Google (Gmail) [adresse Gmail à me donner].
    2. Ouvre ce lien et appuie sur « Devenir testeur » : [lien d'invitation de la console]
    3. Installe l'app depuis le Play Store.
    4. À l'ouverture, choisis « Pour ma boutique » (ou « Pour mes prêts »).
    5. Numéro : [son numéro]. Code : [son code].

    Merci de ne pas désinstaller l'app avant la fin des 14 jours. Dis-moi si quelque chose bloque.
    Aucun argent réel n'est utilisé : les paiements sont des tests.

**Rappels pour toi** : Google compte les testeurs qui ont accepté l'invitation et gardé l'app
installée. Viser 15 à 20 personnes pour avoir de la marge.
