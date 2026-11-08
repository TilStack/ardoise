import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../data/repository.dart';
import '../main.dart';
import 'theme.dart';

/// Première connexion : « Commerçant » ou « Particulier ». Détermine les mots de l'app et les messages de relance.
class ProfileChoiceScreen extends StatefulWidget {
  const ProfileChoiceScreen({super.key});
  @override
  State<ProfileChoiceScreen> createState() => _ProfileChoiceScreenState();
}

class _ProfileChoiceScreenState extends State<ProfileChoiceScreen> {
  String? _type;
  final _name = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (_type == null) {
      return setState(() => _error = 'Choisissez votre profil');
    }
    if (name.length < 2) {
      return setState(
        () => _error = _type == 'PERSONAL'
            ? 'Indiquez votre prénom'
            : 'Indiquez le nom de votre boutique',
      );
    }
    setState(() => [_busy = true, _error = null]);
    try {
      await context.read<ArdoiseRepository>().chooseProfile(_type!, name);
    } on ApiException catch (e) {
      setState(
        () => _error = e.isNetwork
            ? 'Connexion impossible : réessayez avec du réseau.'
            : e.message,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _option(String type, IconData icon, String title, String subtitle) {
    final selected = _type == type;
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: () => setState(() => _type = type),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: selected ? AppColors.orangeSoft : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? AppColors.orange : AppColors.line,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 30, color: AppColors.slate),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(color: AppColors.muted, height: 1.3),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final personal = _type == 'PERSONAL';
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 20),
          children: [
            const Text(
              'Vous utilisez L’Ardoise…',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 20),
            _option(
              'MERCHANT',
              Icons.storefront_outlined,
              'Pour ma boutique',
              'Mes clients achètent à crédit et me paient plus tard.',
            ),
            const SizedBox(height: 12),
            _option(
              'PERSONAL',
              Icons.handshake_outlined,
              'Pour mes prêts',
              'J’ai prêté de l’argent à des proches ou des connaissances.',
            ),
            const SizedBox(height: 24),
            if (_type != null) ...[
              Text(
                personal ? 'Votre prénom' : 'Nom de votre boutique',
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(
                  hintText: personal ? 'Brice' : 'Boutique Brigitte',
                ),
              ),
              const SizedBox(height: 6),
              Text(
                personal
                    ? 'Affiché sur la page de paiement que reçoivent vos proches.'
                    : 'Affiché sur les liens et reçus envoyés à vos clients.',
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.red),
                ),
              ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: const Text('Continuer'),
            ),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => context.read<Session>().signOut(
                      context.read<ArdoiseRepository>(),
                    ),
              child: const Text('Changer de numéro'),
            ),
          ],
        ),
      ),
    );
  }
}
