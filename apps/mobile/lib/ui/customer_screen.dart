import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/money.dart';
import '../data/repository.dart';
import 'entry_screen.dart';
import 'theme.dart';

/// Écran 04 — Fiche client : solde, actions, historique (rien n'est jamais effacé).
class CustomerScreen extends StatefulWidget {
  const CustomerScreen({super.key, required this.customerId});
  final String customerId;
  @override
  State<CustomerScreen> createState() => _CustomerScreenState();
}

class _CustomerScreenState extends State<CustomerScreen> {
  Future<Map<String, dynamic>>? _detail;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() => setState(
    () => _detail = context.read<ArdoiseRepository>().customerDetail(
      widget.customerId,
    ),
  );

  Future<void> _cancel(Map<String, dynamic> h) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Annuler cette saisie ?'),
        content: Text(
          '« ${h['label'] ?? 'Saisie'} » de ${fcfa(h['amount'] as int)}. Elle restera visible, barrée, dans l’historique.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Non'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Annuler la saisie'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<ArdoiseRepository>().cancelEntry(h['id'] as String);
      _reload();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<ArdoiseRepository>();
    final c = repo.byId(widget.customerId);
    if (c == null) {
      return const Scaffold(body: Center(child: Text('Client introuvable')));
    }
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              c.name,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            Text(
              '+237 ${displayPhone(c.phone)}${c.operator != null ? ' · ${c.operator}' : ''}',
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await repo.sync();
          _reload();
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
          children: [
            _BalanceCard(customer: c),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.slate,
                      minimumSize: const Size.fromHeight(46),
                    ),
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) =>
                            EntryScreen(customer: c, kind: EntryKind.debt),
                      ),
                    ).then((_) => _reload()),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Dette'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.field,
                      foregroundColor: AppColors.slate,
                      minimumSize: const Size.fromHeight(46),
                    ),
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) =>
                            EntryScreen(customer: c, kind: EntryKind.cash),
                      ),
                    ).then((_) => _reload()),
                    icon: const Icon(Icons.payments_outlined, size: 18),
                    label: const Text('Espèces'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: c.balance > 0
                  ? () => sendPaymentLink(context, c)
                  : null,
              icon: const Icon(Icons.send_outlined, size: 18),
              label: const Text('Envoyer le lien de paiement'),
            ),
            const SizedBox(height: 20),
            const Row(
              children: [
                Expanded(
                  child: Text(
                    'Historique',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                ),
                Text(
                  'Rien n’est jamais effacé',
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (c.pendingDelta != 0)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Pill(
                  'Des saisies récentes sont en attente de synchronisation',
                  fg: AppColors.amber,
                  bg: AppColors.amberSoft,
                ),
              ),
            FutureBuilder<Map<String, dynamic>>(
              future: _detail,
              builder: (ctx, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (snap.hasError) {
                  return const AppCard(
                    child: Text(
                      'Historique disponible une fois connecté.',
                      style: TextStyle(color: AppColors.muted),
                    ),
                  );
                }
                final history = (snap.data!['history'] as List)
                    .cast<Map<String, dynamic>>();
                if (history.isEmpty) {
                  return const AppCard(
                    child: Text(
                      'Aucune opération.',
                      style: TextStyle(color: AppColors.muted),
                    ),
                  );
                }
                return Column(
                  children: history
                      .map(
                        (h) => _HistoryTile(h: h, onCancel: () => _cancel(h)),
                      )
                      .toList(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.customer});
  final Customer customer;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: AppColors.slate,
      borderRadius: BorderRadius.circular(24),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                customer.balance < 0 ? 'Avoir du client' : 'Doit à la boutique',
                style: const TextStyle(color: Color(0xFFA9B6BC), fontSize: 13),
              ),
            ),
            if (customer.isLate)
              Pill(
                '${customer.daysLate} j de retard',
                fg: const Color(0xFFFDBA74),
                bg: AppColors.chalk.withValues(alpha: .18),
              ),
          ],
        ),
        const SizedBox(height: 10),
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: formatAmount(customer.balance.abs()),
                style: const TextStyle(
                  color: Color(0xFFF4F1EA),
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const TextSpan(
                text: '  FCFA',
                style: TextStyle(
                  color: Color(0xFFA9B6BC),
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.h, required this.onCancel});
  final Map<String, dynamic> h;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final type = h['type'] as String;
    final reversed = h['reversed'] == true;
    final date = DateFormat(
      'd MMM · HH:mm',
      'fr_FR',
    ).format(DateTime.parse(h['occurredAt'] as String).toLocal());
    final (IconData icon, Color fg, Color bg, String title) = switch (type) {
      'DEBT' => (
        Icons.add,
        const Color(0xFFC2410C),
        AppColors.orangeSoft,
        (h['label'] as String?) ?? 'Dette',
      ),
      'CASH_REPAYMENT' => (
        Icons.payments_outlined,
        AppColors.green,
        AppColors.greenSoft,
        'Paiement espèces',
      ),
      'MOBILE_PAYMENT' => (
        Icons.check,
        AppColors.green,
        AppColors.greenSoft,
        (h['label'] as String?) ?? 'Paiement Mobile Money',
      ),
      _ => (
        Icons.undo,
        AppColors.muted,
        AppColors.field,
        'Annulation · ${h['label'] ?? ''}',
      ),
    };
    final signed = h['signedAmount'] as int;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: fg, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      decoration: reversed ? TextDecoration.lineThrough : null,
                      color: reversed ? AppColors.muted : null,
                    ),
                  ),
                  Text(
                    [
                      date,
                      if (h['receiptNumber'] != null)
                        'Reçu n° ${h['receiptNumber']}',
                      if (reversed) 'annulée',
                    ].join(' · '),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              signed == 0
                  ? '0'
                  : '${signed > 0 ? '+' : '−'}${formatAmount(signed.abs())}',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: reversed || signed == 0
                    ? AppColors.muted
                    : signed > 0
                    ? AppColors.red
                    : AppColors.green,
              ),
            ),
            if (!reversed && (type == 'DEBT' || type == 'CASH_REPAYMENT'))
              PopupMenuButton<String>(
                onSelected: (_) => onCancel(),
                itemBuilder: (_) => const [
                  PopupMenuItem(
                    value: 'cancel',
                    child: Text('Annuler cette saisie'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
