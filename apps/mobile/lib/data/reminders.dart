/// Données de l'écran « Relances » (GET /reminders). En ligne uniquement : c'est le serveur qui envoie.
library;

class ReminderSettings {
  const ReminderSettings({
    required this.enabled,
    required this.sendHour,
    required this.channel,
    required this.template,
    required this.customTemplate,
    required this.defaultTemplate,
    required this.optOutSuffix,
  });

  final bool enabled;
  final int sendHour;

  /// WHATSAPP ou SMS
  final String channel;
  final String template;
  final bool customTemplate;
  final String defaultTemplate;
  final String optOutSuffix;

  factory ReminderSettings.fromJson(Map<String, dynamic> j) => ReminderSettings(
    enabled: j['enabled'] as bool,
    sendHour: j['sendHour'] as int,
    channel: j['channel'] as String,
    template: j['template'] as String,
    customTemplate: j['customTemplate'] as bool,
    defaultTemplate: j['defaultTemplate'] as String,
    optOutSuffix: j['optOutSuffix'] as String? ?? '',
  );
}

class ReminderItem {
  const ReminderItem({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.step,
    required this.status,
    required this.channel,
    required this.scheduledAt,
    required this.amount,
    this.sentAt,
    this.sentChannel,
    this.paidAmount = 0,
    this.error,
  });

  final String id;
  final String customerId;
  final String customerName;

  /// 3, 7 ou 14 (jours après le début de la dette)
  final int step;

  /// SCHEDULED, SENDING, SENT, FAILED
  final String status;
  final String channel;
  final DateTime scheduledAt;
  final int amount;
  final DateTime? sentAt;
  final String? sentChannel;
  final int paidAmount;
  final String? error;

  bool get editable => status == 'SCHEDULED';
  bool get fellBackToSms => channel == 'WHATSAPP' && sentChannel == 'SMS';

  factory ReminderItem.fromJson(Map<String, dynamic> j) => ReminderItem(
    id: j['id'] as String,
    customerId: j['customerId'] as String,
    customerName: j['customerName'] as String,
    step: j['step'] as int,
    status: j['status'] as String,
    channel: j['channel'] as String,
    scheduledAt: DateTime.parse(j['scheduledAt'] as String),
    amount: j['amount'] as int? ?? 0,
    sentAt: j['sentAt'] == null ? null : DateTime.parse(j['sentAt'] as String),
    sentChannel: j['sentChannel'] as String?,
    paidAmount: j['paidAmount'] as int? ?? 0,
    error: j['error'] as String?,
  );
}

class RemindersOverview {
  const RemindersOverview({
    required this.settings,
    required this.today,
    required this.recovered,
    required this.scheduled,
    required this.sent,
    required this.paid,
  });

  final ReminderSettings settings;

  /// Relances prévues aujourd'hui.
  final int today;

  /// Montant payé dans les 7 jours suivant une relance (30 derniers jours).
  final int recovered;
  final List<ReminderItem> scheduled;
  final List<ReminderItem> sent;
  final List<ReminderItem> paid;

  factory RemindersOverview.fromJson(Map<String, dynamic> j) {
    List<ReminderItem> list(String k) => (j[k] as List)
        .cast<Map<String, dynamic>>()
        .map(ReminderItem.fromJson)
        .toList();
    return RemindersOverview(
      settings: ReminderSettings.fromJson(
        j['settings'] as Map<String, dynamic>,
      ),
      today: j['today'] as int,
      recovered: j['recovered'] as int? ?? 0,
      scheduled: list('scheduled'),
      sent: list('sent'),
      paid: list('paid'),
    );
  }
}

/// Aperçu du message tel que le client le recevra (même règle que l'API).
String renderReminder(
  String template, {
  required String name,
  required String amount,
  required String shop,
  required String url,
  String suffix = '',
}) {
  final first = name.trim().split(RegExp(r'\s+')).first;
  return template
          .replaceAll(RegExp(r'\{pr[ée]nom\}'), first)
          .replaceAll('{montant}', amount)
          .replaceAll('{boutique}', shop)
          .replaceAll('{lien}', url) +
      suffix;
}

/// Même validation que l'API, pour un retour immédiat dans l'éditeur.
String? validateReminderTemplate(String t) {
  if (t.trim().isEmpty) return 'Le message ne peut pas être vide';
  if (t.length > 300) return 'Message trop long (300 caractères au plus)';
  if (!t.contains('{lien}')) {
    return 'Le message doit contenir {lien} : c’est par là que le client paie';
  }
  const known = {'prénom', 'prenom', 'montant', 'boutique', 'lien'};
  for (final m in RegExp(r'\{([^}]*)\}').allMatches(t)) {
    if (!known.contains(m.group(1))) {
      return 'Variable inconnue : {${m.group(1)}}';
    }
  }
  return null;
}
