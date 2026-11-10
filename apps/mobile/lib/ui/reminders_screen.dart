import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/money.dart';
import '../data/reminders.dart';
import '../data/repository.dart';
import 'theme.dart';

/// Écran 10 — Relances : programmées, envoyées, payées après relance ; message modifiable.
class RemindersScreen extends StatefulWidget {
  const RemindersScreen({super.key});
  @override
  State<RemindersScreen> createState() => _RemindersScreenState();
}

enum _Tab { scheduled, sent, paid }

class _RemindersScreenState extends State<RemindersScreen> {
  RemindersOverview? _data;
  String? _error;
  bool _loading = true;
  _Tab _tab = _Tab.scheduled;

  ApiClient get _api => context.read<ArdoiseRepository>().api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final d = RemindersOverview.fromJson(await _api.reminders());
      if (!mounted) return;
      setState(() {
        _data = d;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(
        () => _error = e.isNetwork
            ? 'Hors-ligne : les relances sont envoyées par le serveur. '
                  'Reconnectez-vous pour les voir.'
            : e.message,
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _run(Future<Object?> Function() call, {String? done}) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await call();
      if (done != null) messenger.showSnackBar(SnackBar(content: Text(done)));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
    await _load();
  }

  Future<void> _settings(Map<String, Object?> changes, {String? done}) =>
      _run(() => _api.updateReminderSettings(changes), done: done);

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Relances',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
                ),
              ),
              if (d != null)
                IconButton(
                  tooltip: 'Réglages des relances',
                  icon: const Icon(Icons.tune),
                  onPressed: () => _openSettings(d.settings),
                ),
            ],
          ),
          const SizedBox(height: 8),
          if (_loading && d == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (d == null)
            AppCard(
              child: Text(
                _error ?? 'Indisponible',
                style: TextStyle(color: context.mutedColor),
              ),
            )
          else ...[
            _Summary(data: d, onEnable: () => _settings({'enabled': true})),
            const SizedBox(height: 14),
            _Tabs(
              current: _tab,
              counts: {
                _Tab.scheduled: d.scheduled.length,
                _Tab.sent: d.sent.where((r) => r.status == 'SENT').length,
                _Tab.paid: d.paid.length,
              },
              onChanged: (t) => setState(() => _tab = t),
            ),
            const SizedBox(height: 12),
            _list(d),
            const SizedBox(height: 16),
            _TemplateCard(settings: d.settings, onEdit: () => _editTemplate(d)),
          ],
        ],
      ),
    );
  }

  Widget _list(RemindersOverview d) {
    final items = switch (_tab) {
      _Tab.scheduled => d.scheduled,
      _Tab.sent => d.sent,
      _Tab.paid => d.paid,
    };
    if (items.isEmpty) {
      final text = switch (_tab) {
        _Tab.scheduled =>
          d.settings.enabled
              ? 'Aucune relance programmée : personne n’est en retard.'
              : 'Relances désactivées.',
        _Tab.sent => 'Aucune relance envoyée ces 30 derniers jours.',
        _Tab.paid => 'Pas encore de paiement après relance.',
      };
      return AppCard(
        child: Text(text, style: TextStyle(color: context.mutedColor)),
      );
    }
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) Divider(height: 1, color: context.hairline),
            _ReminderTile(
              item: items[i],
              tab: _tab,
              onEdit: () => _openActions(items[i]),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _openActions(ReminderItem r) async {
    final other = r.channel == 'WHATSAPP' ? 'SMS' : 'WHATSAPP';
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                title: Text(
                  r.customerName,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text('${fcfa(r.amount)} · J+${r.step}'),
              ),
              ListTile(
                leading: const Icon(Icons.send_outlined),
                title: const Text('Envoyer maintenant'),
                onTap: () => Navigator.pop(ctx, 'send_now'),
              ),
              ListTile(
                leading: const Icon(Icons.schedule),
                title: const Text('Reporter à demain'),
                onTap: () => Navigator.pop(ctx, 'postpone'),
              ),
              ListTile(
                leading: const Icon(Icons.swap_horiz),
                title: Text('Envoyer par ${_channelLabel(other)}'),
                onTap: () => Navigator.pop(ctx, 'set_channel'),
              ),
              ListTile(
                leading: const Icon(Icons.block, color: AppColors.red),
                title: const Text(
                  'Ne pas envoyer cette relance',
                  style: TextStyle(color: AppColors.red),
                ),
                onTap: () => Navigator.pop(ctx, 'skip'),
              ),
            ],
          ),
        ),
      ),
    );
    if (action == null) return;
    const done = {
      'send_now': 'Relance envoyée',
      'postpone': 'Relance reportée à demain',
      'set_channel': 'Canal modifié',
      'skip': 'Relance annulée',
    };
    await _run(() async {
      final res = await _api.reminderAction(
        r.id,
        action,
        channel: action == 'set_channel' ? other : null,
      );
      if (action == 'send_now' && res['outcome'] == 'deferred') {
        throw ApiException(
          'Déjà relancé il y a moins de 48 h : envoi reporté automatiquement',
        );
      }
      return res;
    }, done: done[action]);
  }

  Future<void> _openSettings(ReminderSettings s) async {
    var enabled = s.enabled;
    var hour = s.sendHour;
    var channel = s.channel;
    final save = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => SafeArea(
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Relances automatiques'),
                    subtitle: const Text('J+3, J+7, J+14 · entre 8 h et 20 h'),
                    value: enabled,
                    onChanged: (v) => set(() => enabled = v),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Heure d’envoi',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  DropdownButtonFormField<int>(
                    initialValue: hour,
                    items: [
                      for (var h = 8; h <= 19; h++)
                        DropdownMenuItem(value: h, child: Text('$h h')),
                    ],
                    onChanged: (v) => set(() => hour = v ?? hour),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Canal',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'WHATSAPP', label: Text('WhatsApp')),
                      ButtonSegment(value: 'SMS', label: Text('SMS')),
                    ],
                    selected: {channel},
                    onSelectionChanged: (v) => set(() => channel = v.first),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    context.read<ArdoiseRepository>().vocab.noWhatsapp,
                    style: TextStyle(
                      color: context.mutedColor,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Enregistrer'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (save != true) return;
    await _settings({
      if (enabled != s.enabled) 'enabled': enabled,
      if (hour != s.sendHour) 'sendHour': hour,
      if (channel != s.channel) 'channel': channel,
    }, done: 'Réglages enregistrés');
  }

  Future<void> _editTemplate(RemindersOverview d) async {
    final shop = context.read<ArdoiseRepository>().shopName ?? 'boutique';
    final ctrl = TextEditingController(text: d.settings.template);
    final result = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          0,
          20,
          16 + MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: StatefulBuilder(
          builder: (ctx, set) {
            final error = validateReminderTemplate(ctrl.text);
            return SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Message de relance',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    context.read<ArdoiseRepository>().isPersonal
                        ? 'Variables : {prénom} {montant} {lien}'
                        : 'Variables : {prénom} {montant} {boutique} {lien}',
                    style: TextStyle(
                      color: context.mutedColor,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    key: const Key('template-field'),
                    controller: ctrl,
                    minLines: 3,
                    maxLines: 6,
                    maxLength: 300,
                    onChanged: (_) => set(() {}),
                    decoration: InputDecoration(errorText: error),
                  ),
                  const Text(
                    'Aperçu',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFDCF8C6),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      renderReminder(
                        ctrl.text,
                        name: 'Paul Ngono',
                        amount: formatAmount(12500),
                        shop: shop,
                        url: 'ardoise.cm/p/…',
                        suffix: d.settings.optOutSuffix,
                      ),
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: error == null
                        ? () => Navigator.pop(ctx, ctrl.text.trim())
                        : null,
                    child: const Text('Enregistrer'),
                  ),
                  if (d.settings.customTemplate)
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, ''),
                      child: const Text('Revenir au message par défaut'),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
    if (result == null) return;
    await _settings({
      'template': result.isEmpty ? null : result,
    }, done: 'Message enregistré');
  }
}

String _channelLabel(String c) => c == 'SMS' ? 'SMS' : 'WhatsApp';

class _Summary extends StatelessWidget {
  const _Summary({required this.data, required this.onEnable});
  final RemindersOverview data;
  final VoidCallback onEnable;

  @override
  Widget build(BuildContext context) {
    final s = data.settings;
    final title = !s.enabled
        ? 'Relances désactivées'
        : data.today == 0
        ? 'Aucune relance aujourd’hui'
        : '${data.today} relance${data.today > 1 ? 's' : ''} aujourd’hui';
    return AppCard(
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: s.enabled ? AppColors.orangeSoft : AppColors.greySoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              s.enabled
                  ? Icons.notifications_active_outlined
                  : Icons.notifications_off_outlined,
              color: s.enabled ? const Color(0xFFC2410C) : context.mutedColor,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  s.enabled
                      ? 'Envoi à ${s.sendHour} h · max 1 message / 48 h'
                      : context.read<ArdoiseRepository>().vocab.remindersOff,
                  style: TextStyle(color: context.mutedColor, fontSize: 12),
                ),
                if (data.recovered > 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    '${fcfa(data.recovered)} payés après relance (30 j)',
                    style: const TextStyle(
                      color: AppColors.green,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (!s.enabled)
            TextButton(onPressed: onEnable, child: const Text('Activer')),
        ],
      ),
    );
  }
}

class _Tabs extends StatelessWidget {
  const _Tabs({
    required this.current,
    required this.counts,
    required this.onChanged,
  });
  final _Tab current;
  final Map<_Tab, int> counts;
  final ValueChanged<_Tab> onChanged;

  @override
  Widget build(BuildContext context) {
    const labels = {
      _Tab.scheduled: 'Programmées',
      _Tab.sent: 'Envoyées',
      _Tab.paid: 'Payées',
    };
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: context.fieldTint,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          for (final t in _Tab.values)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(t),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  decoration: BoxDecoration(
                    color: t == current
                        ? context.cardSurface
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text.rich(
                      TextSpan(
                        text: '${labels[t]} ',
                        children: [
                          TextSpan(
                            text: '${counts[t] ?? 0}',
                            style: TextStyle(color: context.mutedColor),
                          ),
                        ],
                      ),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: t == current
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ReminderTile extends StatelessWidget {
  const _ReminderTile({
    required this.item,
    required this.tab,
    required this.onEdit,
  });
  final ReminderItem item;
  final _Tab tab;
  final VoidCallback onEdit;

  String _when(DateTime t) {
    final local = t.toLocal();
    final now = DateTime.now();
    final sameDay =
        local.year == now.year &&
        local.month == now.month &&
        local.day == now.day;
    final time = DateFormat('HH:mm', 'fr_FR').format(local);
    return sameDay
        ? time
        : '${DateFormat('d MMM', 'fr_FR').format(local)} $time';
  }

  @override
  Widget build(BuildContext context) {
    final r = item;
    final channel = _channelLabel(r.sentChannel ?? r.channel);
    final at = tab == _Tab.scheduled
        ? r.scheduledAt
        : (r.sentAt ?? r.scheduledAt);
    Widget? trailing;
    if (tab == _Tab.scheduled && r.editable) {
      trailing = TextButton(
        onPressed: onEdit,
        style: TextButton.styleFrom(foregroundColor: const Color(0xFFC2410C)),
        child: const Text('Modifier'),
      );
    } else if (r.status == 'SENDING') {
      trailing = const Pill(
        'Envoi…',
        fg: AppColors.amber,
        bg: AppColors.amberSoft,
      );
    } else if (r.status == 'FAILED') {
      trailing = const Pill('Échec', fg: AppColors.red, bg: AppColors.redSoft);
    } else if (r.paidAmount > 0) {
      trailing = Pill(
        'Payé ${formatAmount(r.paidAmount)}',
        fg: AppColors.green,
        bg: AppColors.greenSoft,
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      child: Row(
        children: [
          Avatar(initials(r.customerName)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.customerName,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '${fcfa(r.amount)} · J+${r.step} · $channel'
                  '${r.fellBackToSms ? ' (repli)' : ''} · ${_when(at)}',
                  style: TextStyle(color: context.mutedColor, fontSize: 12),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ],
            ),
          ),
          if (trailing != null) trailing,
        ],
      ),
    );
  }
}

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({required this.settings, required this.onEdit});
  final ReminderSettings settings;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onEdit,
    borderRadius: BorderRadius.circular(20),
    child: AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  settings.customTemplate
                      ? 'Message personnalisé'
                      : 'Message par défaut',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Icon(Icons.edit_outlined, size: 18, color: context.mutedColor),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '« ${settings.template} »',
            style: TextStyle(color: context.mutedColor, fontSize: 13),
          ),
        ],
      ),
    ),
  );
}
