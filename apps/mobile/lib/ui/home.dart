import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/money.dart';
import '../data/repository.dart';
import '../main.dart';
import 'customer_screen.dart';
import 'entry_screen.dart';
import 'reminders_screen.dart';
import 'theme.dart';

/// Coque principale : Accueil · Clients · (+) · Relances · Profil.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final repo = context.read<ArdoiseRepository>();
      final notice = repo.takeProfileNotice();
      if (notice != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(notice), duration: const Duration(seconds: 6)),
        );
      }
      repo.sync();
    });
  }

  @override
  Widget build(BuildContext context) {
    final v = context.watch<ArdoiseRepository>().vocab;
    final pages = [
      const DashboardScreen(),
      const CustomersScreen(),
      const RemindersScreen(),
      const ProfileScreen(),
    ];
    return Scaffold(
      body: SafeArea(child: pages[_tab]),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.orange,
        foregroundColor: Colors.white,
        tooltip: v.newDebt,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        onPressed: () => pickCustomerThen(context, EntryKind.debt),
        child: const Icon(Icons.add, size: 28),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Accueil',
          ),
          NavigationDestination(
            icon: const Icon(Icons.people_outline),
            selectedIcon: const Icon(Icons.people),
            label: v.people,
          ),
          const NavigationDestination(
            icon: Icon(Icons.notifications_none),
            selectedIcon: Icon(Icons.notifications),
            label: 'Relances',
          ),
          const NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profil',
          ),
        ],
      ),
    );
  }
}

/// Bandeau d'état de synchronisation (hors-ligne, saisies en attente).
class SyncBanner extends StatelessWidget {
  const SyncBanner({super.key});
  @override
  Widget build(BuildContext context) {
    final r = context.watch<ArdoiseRepository>();
    if (r.online && r.pendingCount == 0 && r.lastError == null) {
      return const SizedBox.shrink();
    }
    final text = !r.online
        ? 'Hors-ligne · ${r.pendingCount} saisie(s) seront synchronisées'
        : r.lastError ?? '${r.pendingCount} saisie(s) en cours d’envoi…';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.amberSoft,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            r.online ? Icons.sync : Icons.wifi_off,
            size: 16,
            color: AppColors.amber,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: AppColors.amber,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Écran 02 — Tableau de bord.
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final r = context.watch<ArdoiseRepository>();
    final late = r.late;
    return RefreshIndicator(
      onRefresh: r.sync,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Bonjour',
                      style: TextStyle(color: AppColors.muted, fontSize: 13),
                    ),
                    Text(
                      r.shopName ?? r.vocab.homeTitle,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              if (r.syncing)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: 16),
          const SyncBanner(),
          _Slate(
            totalOwed: r.totalOwed,
            customersLabel: r.vocab.count(r.customers.length),
            lateCount: late.length,
            collected: r.dashboard.collectedThisMonth,
            inTransit: r.dashboard.inTransit,
          ),
          const SizedBox(height: 16),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _QuickAction(
                  icon: Icons.add,
                  label: r.vocab.newDebt,
                  fg: const Color(0xFFC2410C),
                  bg: AppColors.orangeSoft,
                  onTap: () => pickCustomerThen(context, EntryKind.debt),
                ),
                const SizedBox(width: 10),
                _QuickAction(
                  icon: Icons.payments_outlined,
                  label: r.vocab.cashReceived,
                  fg: AppColors.green,
                  bg: AppColors.greenSoft,
                  onTap: () => pickCustomerThen(context, EntryKind.cash),
                ),
                const SizedBox(width: 10),
                _QuickAction(
                  icon: Icons.send_outlined,
                  label: 'Envoyer un lien',
                  fg: AppColors.slate,
                  bg: AppColors.greySoft,
                  onTap: () => pickCustomerThen(context, null),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'À relancer',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          if (late.isEmpty)
            AppCard(
              child: Text(
                r.vocab.noLate,
                style: const TextStyle(color: AppColors.muted),
              ),
            )
          else
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: late
                    .take(5)
                    .map((c) => CustomerTile(customer: c))
                    .toList(),
              ),
            ),
        ],
      ),
    );
  }
}

class _Slate extends StatelessWidget {
  const _Slate({
    required this.totalOwed,
    required this.customersLabel,
    required this.lateCount,
    required this.collected,
    required this.inTransit,
  });
  final int totalOwed, lateCount, collected, inTransit;
  final String customersLabel;

  @override
  Widget build(BuildContext context) {
    Widget tile(String k, int v) => Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .07),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              k,
              style: const TextStyle(color: Color(0xFFA9B6BC), fontSize: 11),
            ),
            const SizedBox(height: 4),
            Text(
              formatAmount(v),
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 15,
              ),
            ),
          ],
        ),
      ),
    );
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          colors: [Color(0xFF24353E), Color(0xFF1A262D)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'On vous doit',
            style: TextStyle(color: Color(0xFFA9B6BC), fontSize: 13),
          ),
          const SizedBox(height: 10),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: formatAmount(totalOwed),
                  style: const TextStyle(
                    color: Color(0xFFF4F1EA),
                    fontSize: 36,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.7,
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
          const SizedBox(height: 12),
          Row(
            children: [
              Pill(
                customersLabel,
                fg: const Color(0xFFF4F1EA),
                bg: Colors.white.withValues(alpha: .1),
              ),
              const SizedBox(width: 8),
              if (lateCount > 0)
                Pill(
                  '$lateCount en retard',
                  fg: const Color(0xFFFDBA74),
                  bg: AppColors.chalk.withValues(alpha: .18),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              tile('Encaissé ce mois', collected),
              const SizedBox(width: 12),
              tile('En transit (MoMo)', inTransit),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.fg,
    required this.bg,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final Color fg, bg;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Expanded(
    child: InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
        decoration: BoxDecoration(
          color: context.cardSurface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: context.hairline),
        ),
        child: Column(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: fg),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Ligne client réutilisée dans le tableau de bord et la liste.
class CustomerTile extends StatelessWidget {
  const CustomerTile({super.key, required this.customer});
  final Customer customer;

  @override
  Widget build(BuildContext context) {
    final c = customer;
    final (Color fg, Color bg, String pill) = c.balance < 0
        ? (AppColors.green, AppColors.greenSoft, 'Avoir')
        : c.balance == 0
        ? (AppColors.green, AppColors.greenSoft, 'Soldé')
        : c.isLate
        ? (AppColors.red, AppColors.redSoft, '${c.daysLate} j')
        : (const Color(0xFF33454E), AppColors.greySoft, 'À jour');
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => CustomerScreen(customerId: c.id)),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: context.hairline)),
        ),
        child: Row(
          children: [
            Avatar(initials(c.name), fg: fg, bg: bg),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    c.name,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    c.pendingDelta != 0 || !c.synced
                        ? 'En attente de synchro'
                        : displayPhone(c.phone),
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatAmount(c.balance.abs()),
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: c.isLate ? AppColors.red : context.inkColor,
                  ),
                ),
                const SizedBox(height: 4),
                Pill(pill, fg: fg, bg: bg),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Écran 03 — Clients.
class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});
  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  String _q = '';
  bool _lateOnly = false;

  @override
  Widget build(BuildContext context) {
    final r = context.watch<ArdoiseRepository>();
    var list = r.customers;
    if (_lateOnly) list = list.where((c) => c.isLate).toList();
    if (_q.isNotEmpty) {
      final q = _q.toLowerCase();
      list = list
          .where(
            (c) =>
                c.name.toLowerCase().contains(q) ||
                c.phone.contains(_q.replaceAll(' ', '')),
          )
          .toList();
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                r.vocab.people,
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            IconButton.filledTonal(
              onPressed: () => showAddCustomer(context),
              icon: const Icon(Icons.person_add_alt_1),
              tooltip: r.vocab.addPerson,
            ),
          ],
        ),
        const SizedBox(height: 12),
        const SyncBanner(),
        TextField(
          onChanged: (v) => setState(() => _q = v),
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search),
            hintText: 'Rechercher un nom ou un numéro',
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              label: Text('Tous  ${r.customers.length}'),
              selected: !_lateOnly,
              onSelected: (_) => setState(() => _lateOnly = false),
            ),
            ChoiceChip(
              label: Text('En retard  ${r.late.length}'),
              selected: _lateOnly,
              onSelected: (_) => setState(() => _lateOnly = true),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (list.isEmpty)
          AppCard(
            child: Text(
              r.vocab.emptyList,
              style: const TextStyle(color: AppColors.muted),
            ),
          )
        else
          AppCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: list.map((c) => CustomerTile(customer: c)).toList(),
            ),
          ),
      ],
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _editName(BuildContext context, ArdoiseRepository r) async {
    final ctrl = TextEditingController(text: r.shopName);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(r.vocab.nameTitle),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text),
            child: const Text('Enregistrer'),
          ),
        ],
      ),
    );
    if (name != null && name.trim().length >= 2) {
      await r.setShopName(name.trim());
    }
  }

  Future<void> _logout(BuildContext context, ArdoiseRepository r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Se déconnecter ?'),
        content: Text(
          r.pendingCount > 0
              ? '${r.pendingCount} saisie(s) ne sont pas encore synchronisées : reconnectez-vous d’abord au réseau, sinon elles seront perdues.'
              : 'Vos données restent sur le serveur : vous les retrouverez en vous reconnectant.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Annuler'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text(
              'Se déconnecter',
              style: TextStyle(color: AppColors.red),
            ),
          ),
        ],
      ),
    );
    if (ok == true && context.mounted) {
      await context.read<Session>().signOut(r);
    }
  }

  Future<void> _deleteAccount(BuildContext context, ArdoiseRepository r) async {
    final v = r.vocab;
    final unsettled = r.customers.where((c) => c.balance != 0).length;
    if (unsettled > 0) {
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Suppression impossible'),
          content: Text(
            '$unsettled ${v.person}${unsettled > 1 ? 's ont' : ' a'} encore un compte non réglé. '
            'Soldez tous les comptes avant de supprimer le vôtre.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Compris'),
            ),
          ],
        ),
      );
      return;
    }
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Supprimer mon compte ?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Cette action est définitive. Toutes vos données seront effacées du serveur et du téléphone : '
                '${v.people.toLowerCase()}, historique, reçus et relances.\n\n'
                'Tapez SUPPRIMER pour confirmer.',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ctrl,
                onChanged: (_) => set(() {}),
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(hintText: 'SUPPRIMER'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Annuler'),
            ),
            TextButton(
              onPressed: ctrl.text.trim().toUpperCase() == 'SUPPRIMER'
                  ? () => Navigator.pop(ctx, true)
                  : null,
              child: const Text(
                'Supprimer définitivement',
                style: TextStyle(color: AppColors.red),
              ),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final session = context.read<Session>();
    try {
      await r.deleteAccount();
      await session.signOut(r);
      messenger.showSnackBar(
        const SnackBar(content: Text('Votre compte a été supprimé.')),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = context.watch<ArdoiseRepository>();
    final name = r.shopName;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          'Profil',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 16),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Avatar(
                    initials(name ?? '?'),
                    fg: AppColors.orange,
                    bg: AppColors.orangeSoft,
                    size: 48,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name ?? r.vocab.nameTitle,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 17,
                          ),
                        ),
                        if (r.phone != null)
                          Text(
                            '+237 ${displayPhone(r.phone!)}',
                            style: const TextStyle(
                              color: AppColors.muted,
                              fontSize: 13,
                            ),
                          ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Modifier le nom',
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () => _editName(context, r),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(
                    r.isPersonal
                        ? Icons.handshake_outlined
                        : Icons.storefront_outlined,
                    size: 18,
                    color: AppColors.muted,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      r.isPersonal
                          ? 'Profil : Particulier (prêts)'
                          : 'Profil : Commerçant (boutique)',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                r.vocab.nameHelp,
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Apparence',
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        SegmentedButton<ThemeMode>(
          showSelectedIcon: false,
          segments: const [
            ButtonSegment(
              value: ThemeMode.light,
              icon: Icon(Icons.light_mode_outlined, size: 18),
              label: Text('Clair'),
            ),
            ButtonSegment(
              value: ThemeMode.dark,
              icon: Icon(Icons.dark_mode_outlined, size: 18),
              label: Text('Sombre'),
            ),
            ButtonSegment(
              value: ThemeMode.system,
              icon: Icon(Icons.brightness_auto_outlined, size: 18),
              label: Text('Auto'),
            ),
          ],
          selected: {r.themeMode},
          onSelectionChanged: (s) => r.setThemeMode(s.first),
        ),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          onPressed: () => _logout(context, r),
          icon: const Icon(Icons.logout, color: AppColors.red),
          label: const Text(
            'Se déconnecter',
            style: TextStyle(color: AppColors.red),
          ),
        ),
        const SizedBox(height: 8),
        TextButton.icon(
          onPressed: () => _deleteAccount(context, r),
          icon: const Icon(Icons.delete_forever_outlined, color: AppColors.red),
          label: const Text(
            'Supprimer mon compte',
            style: TextStyle(color: AppColors.red),
          ),
        ),
      ],
    );
  }
}
