/// Mots de l'app selon le profil : un commerçant a des « clients » qui lui doivent des « dettes »,
/// un particulier a des « personnes » à qui il a fait un « prêt ».
class Vocab {
  const Vocab({required this.personal});
  final bool personal;

  String get people => personal ? 'Personnes' : 'Clients';
  String get person => personal ? 'personne' : 'client';
  String get thePerson => personal ? 'cette personne' : 'ce client';
  String get newPerson => personal ? 'Nouvelle personne' : 'Nouveau client';
  String get addPerson =>
      personal ? 'Ajouter une personne' : 'Ajouter un client';
  String get forWhichPerson =>
      personal ? 'Pour quelle personne ?' : 'Pour quel client ?';
  String get debt => personal ? 'Prêt' : 'Dette';
  String get newDebt => personal ? 'Nouveau prêt' : 'Nouvelle dette';
  String get cashReceived => personal ? 'Remboursement reçu' : 'Espèces reçues';
  String get cashShort => personal ? 'Remboursé' : 'Espèces';
  String get cashEntryDone =>
      personal ? 'Remboursement reçu' : 'Paiement espèces';
  String get homeTitle => personal ? 'Mon carnet' : 'Ma boutique';
  String get nameTitle => personal ? 'Votre prénom' : 'Nom de la boutique';
  String get nameHelp => personal
      ? 'Affiché sur la page de paiement envoyée aux personnes'
      : 'Affiché sur les liens et reçus envoyés aux clients';
  String get noLate => personal
      ? 'Personne n’est en retard. Bravo !'
      : 'Aucun client en retard. Bravo !';
  String get emptyList => personal
      ? 'Aucune personne. Ajoutez la première avec le bouton en haut.'
      : 'Aucun client. Ajoutez votre premier client avec le bouton en haut.';
  String get owesLabel => personal ? 'Me doit' : 'Doit à la boutique';
  String get creditLabel =>
      personal ? 'Avance de la personne' : 'Avoir du client';
  String count(int n) => personal
      ? '$n personne${n > 1 ? 's' : ''}'
      : '$n client${n > 1 ? 's' : ''}';
  String get remindersOff => personal
      ? 'Vos proches ne reçoivent plus de rappels'
      : 'Vos clients ne reçoivent plus de rappels';
  String get noWhatsapp => personal
      ? 'Si la personne n’a pas WhatsApp, le rappel part par SMS.'
      : 'Si le client n’a pas WhatsApp, le rappel part par SMS.';
  String get tagline => personal
      ? 'Votre carnet de prêts,\nsans le carnet.'
      : 'Votre cahier de crédit,\nsans le cahier.';
}
