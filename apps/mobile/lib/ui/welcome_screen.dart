import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/repository.dart';
import 'logo_mark.dart';
import 'profile_option.dart';

/// Écran d'entrée : on choisit d'abord à quoi sert l'app, puis on saisit son numéro.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<ArdoiseRepository>();
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 20),
          children: [
            Row(
              children: [
                const LogoMark(size: 44),
                const SizedBox(width: 10),
                const Text(
                  "L'Ardoise",
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                ),
              ],
            ),
            const SizedBox(height: 28),
            const Text(
              'Bienvenue.\nVous utilisez L’Ardoise…',
              style: TextStyle(
                fontSize: 26,
                height: 1.15,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 22),
            ProfileOption(
              icon: Icons.storefront_outlined,
              title: profileMerchantTitle,
              subtitle: profileMerchantText,
              onTap: () => repo.setWelcomeChoice('MERCHANT'),
            ),
            const SizedBox(height: 12),
            ProfileOption(
              icon: Icons.handshake_outlined,
              title: profilePersonalTitle,
              subtitle: profilePersonalText,
              onTap: () => repo.setWelcomeChoice('PERSONAL'),
            ),
            const SizedBox(height: 20),
            Center(
              child: TextButton(
                onPressed: () => repo.setWelcomeChoice('EXISTING'),
                child: const Text('J’ai déjà un compte'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
