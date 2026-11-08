import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api_client.dart';
import '../core/money.dart';
import '../data/repository.dart';
import 'theme.dart';

/// Choisit un client (ou en crée un) puis ouvre la saisie — ou l'envoi du lien si [kind] est null.
Future<void> pickCustomerThen(BuildContext context, EntryKind? kind) async {
  final repo = context.read<ArdoiseRepository>();
  final v = repo.vocab;
  final picked = await showModalBottomSheet<Customer>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: .7,
      builder: (ctx, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          Text(
            v.forWhichPerson,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          ListTile(
            leading: const Avatar(
              '+',
              fg: AppColors.orange,
              bg: AppColors.orangeSoft,
            ),
            title: Text(v.newPerson),
            onTap: () async {
              final c = await showAddCustomer(ctx);
              if (c != null && ctx.mounted) Navigator.pop(ctx, c);
            },
          ),
          ...repo.customers.map(
            (c) => ListTile(
              leading: Avatar(initials(c.name)),
              title: Text(c.name),
              subtitle: Text('Doit ${fcfa(c.balance)}'),
              onTap: () => Navigator.pop(ctx, c),
            ),
          ),
        ],
      ),
    ),
  );
  if (picked == null || !context.mounted) return;
  if (kind == null) {
    await sendPaymentLink(context, picked);
  } else {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => EntryScreen(customer: picked, kind: kind),
      ),
    );
  }
}

Future<Customer?> showAddCustomer(BuildContext context) {
  final name = TextEditingController();
  final phone = TextEditingController();
  final v = context.read<ArdoiseRepository>().vocab;
  String? error;
  return showDialog<Customer>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => AlertDialog(
        title: Text(v.newPerson),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                hintText: 'Nom (ex. Paul Ngono)',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                prefixText: '+237  ',
                hintText: '6 77 12 34 56',
              ),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  error!,
                  style: const TextStyle(color: AppColors.red),
                ),
              ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Annuler'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(120, 44)),
            onPressed: () async {
              final e164 = normalizeCmPhone(phone.text);
              if (name.text.trim().isEmpty) {
                return set(() => error = 'Le nom est obligatoire');
              }
              if (e164 == null) {
                return set(() => error = 'Numéro camerounais invalide');
              }
              final c = await context.read<ArdoiseRepository>().addCustomer(
                name.text,
                e164,
              );
              if (ctx.mounted) Navigator.pop(ctx, c);
            },
            child: const Text('Ajouter'),
          ),
        ],
      ),
    ),
  );
}

/// Écran 05 — Saisie d'une dette ou d'un remboursement espèces. Fonctionne hors-ligne.
class EntryScreen extends StatefulWidget {
  const EntryScreen({super.key, required this.customer, required this.kind});
  final Customer customer;
  final EntryKind kind;
  @override
  State<EntryScreen> createState() => _EntryScreenState();
}

class _EntryScreenState extends State<EntryScreen> {
  String _digits = '';
  final _label = TextEditingController();
  bool _saving = false;

  int get _amount => int.tryParse(_digits) ?? 0;

  void _key(String k) {
    HapticFeedback.selectionClick();
    setState(() {
      if (k == '⌫') {
        if (_digits.isNotEmpty) {
          _digits = _digits.substring(0, _digits.length - 1);
        }
      } else if ((_digits + k).length <= 8) {
        _digits = (_digits + k).replaceFirst(RegExp(r'^0+'), '');
      }
    });
  }

  void _add(int v) => setState(() => _digits = '${_amount + v}');

  Future<void> _save() async {
    final v = context.read<ArdoiseRepository>().vocab;
    setState(() => _saving = true);
    await context.read<ArdoiseRepository>().addEntry(
      customerId: widget.customer.id,
      kind: widget.kind,
      amount: _amount,
      label: _label.text,
    );
    if (!mounted) return;
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${widget.kind == EntryKind.debt ? v.debt : v.cashEntryDone} de ${fcfa(_amount)} enregistré',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final debt = widget.kind == EntryKind.debt;
    final online = context.watch<ArdoiseRepository>().online;
    final v = context.watch<ArdoiseRepository>().vocab;
    final keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              debt ? v.newDebt : v.cashReceived,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            Text(
              '${widget.customer.name} · doit déjà ${formatAmount(widget.customer.balance)}',
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ],
        ),
      ),
      // Le bouton reste visible quelle que soit la hauteur d'écran.
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: debt ? AppColors.slate : AppColors.green,
            ),
            onPressed: _amount > 0 && !_saving ? _save : null,
            child: Text('Enregistrer · ${fcfa(_amount)}'),
          ),
        ),
      ),
      body: SafeArea(
        // Défilant si l'écran est trop court (Android d'entrée de gamme), plein écran sinon.
        child: LayoutBuilder(
          builder: (context, box) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight),
              child: IntrinsicHeight(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                  child: Column(
                    children: [
                      const SizedBox(height: 8),
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: formatAmount(_amount),
                              style: const TextStyle(
                                fontSize: 52,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -1.5,
                              ),
                            ),
                            const TextSpan(
                              text: '  FCFA',
                              style: TextStyle(
                                fontSize: 18,
                                color: Color(0xFF8A9399),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                        key: const Key('amount'),
                      ),
                      if (!online)
                        const Padding(
                          padding: EdgeInsets.only(top: 6),
                          child: Pill(
                            'Hors-ligne · sera synchronisé',
                            fg: AppColors.amber,
                            bg: AppColors.amberSoft,
                          ),
                        ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        children: [500, 1000, 2000, 5000]
                            .map(
                              (v) => ActionChip(
                                label: Text('+${formatAmount(v)}'),
                                onPressed: () => _add(v),
                              ),
                            )
                            .toList(),
                      ),
                      const SizedBox(height: 12),
                      if (debt)
                        TextField(
                          controller: _label,
                          decoration: const InputDecoration(
                            hintText: 'Libellé (ex. Riz 5 kg, huile 1 L)',
                          ),
                        ),
                      const Spacer(),
                      for (var row = 0; row < 4; row++)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Row(
                            children: [
                              for (var col = 0; col < 3; col++) ...[
                                if (col > 0) const SizedBox(width: 8),
                                Expanded(
                                  child: _Key(keys[row * 3 + col], onTap: _key),
                                ),
                              ],
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Écran 06 — Envoi du lien de paiement (WhatsApp, SMS ou copie).
Future<void> sendPaymentLink(BuildContext context, Customer c) async {
  final repo = context.read<ArdoiseRepository>();
  final messenger = ScaffoldMessenger.of(context);
  Map<String, dynamic> link;
  try {
    link = await repo.paymentLink(c.id);
  } on ApiException catch (e) {
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          e.isNetwork ? 'Connexion nécessaire pour créer le lien' : e.message,
        ),
      ),
    );
    return;
  }
  if (!context.mounted) return;
  final message = link['message'] as String;
  final digits = c.phone.replaceAll('+', '');
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Envoyer le lien',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFE7DDD0),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                message,
                style: const TextStyle(height: 1.45, color: AppColors.ink),
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            icon: const Icon(Icons.chat_outlined),
            label: const Text('Envoyer sur WhatsApp'),
            onPressed: () => launchUrl(
              Uri.parse(
                'https://wa.me/$digits?text=${Uri.encodeComponent(message)}',
              ),
              mode: LaunchMode.externalApplication,
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.sms_outlined),
            label: const Text('Envoyer par SMS'),
            onPressed: () => launchUrl(
              Uri(
                scheme: 'sms',
                path: c.phone,
                queryParameters: {'body': message},
              ),
            ),
          ),
          TextButton.icon(
            icon: const Icon(Icons.copy),
            label: const Text('Copier le lien'),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: link['url'] as String));
              Navigator.pop(ctx);
              messenger.showSnackBar(
                const SnackBar(content: Text('Lien copié')),
              );
            },
          ),
        ],
      ),
    ),
  );
}

class _Key extends StatelessWidget {
  const _Key(this.label, {required this.onTap});
  final String label;
  final void Function(String) onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 46,
    child: Material(
      color: context.cardSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: context.hairline),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => onTap(label),
        child: Center(
          child: label == '⌫'
              ? const Icon(Icons.backspace_outlined, semanticLabel: 'Effacer')
              : Text(
                  label,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                  ),
                ),
        ),
      ),
    ),
  );
}
