import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/money.dart';
import '../data/repository.dart';
import '../main.dart';
import 'theme.dart';

/// Écran 01 — Connexion par numéro + code SMS.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String? _e164;
  String? _error;
  bool _busy = false;

  Future<void> _requestCode() async {
    final e164 = normalizeCmPhone(_phone.text);
    if (e164 == null) {
      return setState(() => _error = 'Numéro camerounais invalide');
    }
    setState(() => [_busy = true, _error = null]);
    try {
      final r = await context.read<ArdoiseRepository>().api.requestOtp(e164);
      setState(() => _e164 = e164);
      // En développement, l'API renvoie le code (OTP_DEV_ECHO) : on le pré-remplit.
      if (r['devCode'] != null) _code.text = r['devCode'] as String;
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final repo = context.read<ArdoiseRepository>();
    final session = context.read<Session>();
    setState(() => [_busy = true, _error = null]);
    try {
      final r = await repo.api.verifyOtp(_e164!, _code.text.trim());
      await session.signIn(r['token'] as String);
      final merchant = r['merchant'] as Map;
      final shop = merchant['shopName'] as String?;
      if (shop != null) await repo.setShopName(shop);
      await repo.setProfileFromServer(
        merchant['profileType'] as String?,
        phone: merchant['phone'] as String?,
      );
      await repo.sync();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final codeStep = _e164 != null;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _busy
                    ? null
                    : () => context.read<ArdoiseRepository>().setWelcomeChoice(
                        null,
                      ),
                icon: const Icon(Icons.arrow_back, size: 18),
                label: Text(switch (context
                    .watch<ArdoiseRepository>()
                    .welcomeChoice) {
                  'MERCHANT' => 'Pour ma boutique · changer',
                  'PERSONAL' => 'Pour mes prêts · changer',
                  _ => 'J’ai déjà un compte · changer',
                }),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.slate,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text(
                    'A',
                    style: TextStyle(
                      color: AppColors.chalk,
                      fontWeight: FontWeight.w800,
                      fontSize: 20,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  "L'Ardoise",
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const _ChalkBoard(),
            const SizedBox(height: 20),
            const Text(
              'Votre carnet de dettes,\nsans le carnet.',
              style: TextStyle(
                fontSize: 26,
                height: 1.15,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Notez ce qu’on vous doit en 3 secondes. Ils paient par MoMo ou Orange Money, même en plusieurs fois.',
              style: TextStyle(color: AppColors.muted, height: 1.5),
            ),
            const SizedBox(height: 24),
            if (!codeStep) ...[
              const Text(
                'Numéro de téléphone',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  prefixText: '+237  ',
                  hintText: '6 77 12 34 56',
                ),
              ),
            ] else ...[
              Text(
                'Code envoyé au ${displayPhone(_e164!)}',
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 24,
                  letterSpacing: 8,
                  fontWeight: FontWeight.w700,
                ),
                decoration: const InputDecoration(
                  counterText: '',
                  hintText: '••••••',
                ),
              ),
              TextButton(
                onPressed: _busy ? null : () => setState(() => _e164 = null),
                child: const Text('Changer de numéro'),
              ),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.red),
                ),
              ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : (codeStep ? _verify : _requestCode),
              child: Text(
                codeStep ? 'Se connecter' : 'Recevoir mon code par SMS',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChalkBoard extends StatelessWidget {
  const _ChalkBoard();
  @override
  Widget build(BuildContext context) {
    const style = TextStyle(
      color: Color(0xFFEDE9E0),
      fontSize: 15,
      fontWeight: FontWeight.w500,
    );
    Widget line(String a, String b, {bool last = false}) => Container(
      padding: const EdgeInsets.only(bottom: 8),
      margin: const EdgeInsets.only(top: 10),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: Color(0x40EDE9E0))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Text(a, style: style, overflow: TextOverflow.ellipsis),
          ),
          const SizedBox(width: 12),
          Text(b, style: style),
        ],
      ),
    );
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.slate,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'ARDOISE DU JOUR',
            style: TextStyle(
              color: AppColors.chalk,
              fontSize: 12,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w700,
            ),
          ),
          line('Paul N.', '3 500'),
          line('Maman Clarisse', '12 000'),
          line('Junior (taxi)', '1 500', last: true),
        ],
      ),
    );
  }
}
