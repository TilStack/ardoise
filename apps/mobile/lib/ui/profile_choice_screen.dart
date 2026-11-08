import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../data/repository.dart';
import '../main.dart';
import 'profile_option.dart';
import 'theme.dart';

/// Première connexion : « Commerçant » ou « Particulier ». Détermine les mots de l'app et les messages de relance.
class ProfileChoiceScreen extends StatefulWidget {
  const ProfileChoiceScreen({super.key, this.initialType});

  /// Profil déjà choisi sur l'écran d'accueil, avant la connexion : il ne reste qu'à saisir le nom.
  final String? initialType;
  @override
  State<ProfileChoiceScreen> createState() => _ProfileChoiceScreenState();
}

class _ProfileChoiceScreenState extends State<ProfileChoiceScreen> {
  late String? _type = widget.initialType;
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

  Widget _option(String type, IconData icon, String title, String subtitle) =>
      ProfileOption(
        icon: icon,
        title: title,
        subtitle: subtitle,
        selected: _type == type,
        onTap: () => setState(() => _type = type),
      );

  @override
  Widget build(BuildContext context) {
    final personal = _type == 'PERSONAL';
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 20),
          children: [
            Text(
              widget.initialType == null
                  ? 'Vous utilisez L’Ardoise…'
                  : 'Dernière étape',
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 20),
            _option(
              'MERCHANT',
              Icons.storefront_outlined,
              profileMerchantTitle,
              profileMerchantText,
            ),
            const SizedBox(height: 12),
            _option(
              'PERSONAL',
              Icons.handshake_outlined,
              profilePersonalTitle,
              profilePersonalText,
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
