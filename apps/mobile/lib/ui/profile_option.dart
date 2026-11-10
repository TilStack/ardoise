import 'package:flutter/material.dart';

import 'theme.dart';

/// Carte de choix d'un profil (« Pour ma boutique » / « Pour mes prêts »).
class ProfileOption extends StatelessWidget {
  const ProfileOption({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.selected = false,
  });
  final IconData icon;
  final String title, subtitle;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: selected
              ? (context.isDark ? AppColors.darkField : AppColors.orangeSoft)
              : context.cardSurface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? AppColors.orange : context.hairline,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 30, color: context.iconInk),
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
                    style: TextStyle(color: context.mutedColor, height: 1.3),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Les deux profils, avec leurs textes : partagés par l'accueil et le choix après connexion.
const profileMerchantTitle = 'Pour ma boutique';
const profileMerchantText =
    'Mes clients achètent à crédit et me paient plus tard.';
const profilePersonalTitle = 'Pour mes prêts';
const profilePersonalText =
    'J’ai prêté de l’argent à des proches ou des connaissances.';
