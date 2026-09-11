import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../features/auth/providers/auth_provider.dart';

class AdminScaffold extends StatelessWidget {
  final String title;
  final Widget body;
  final List<Widget>? actions;

  const AdminScaffold({
    super.key,
    required this.title,
    required this.body,
    this.actions,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: actions),
      drawer: const _AdminDrawer(),
      body: body,
    );
  }
}

class _AdminDrawer extends ConsumerWidget {
  const _AdminDrawer();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;
    final path = GoRouterState.of(context).uri.path;

    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          DrawerHeader(
            decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                const Icon(Icons.admin_panel_settings_rounded,
                    color: Colors.white, size: 36),
                const SizedBox(height: 8),
                const Text('لوحة الإدارة',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.bold)),
                Text(user?.fullName ?? '',
                    style: const TextStyle(
                        color: Colors.white70, fontSize: 13)),
              ],
            ),
          ),
          _NavTile(icon: Icons.dashboard_rounded, label: 'لوحة التحكم', route: '/admin', exact: true, currentPath: path),
          _NavTile(icon: Icons.people_rounded, label: 'المستخدمون', route: '/admin/users', currentPath: path),
          _NavTile(icon: Icons.directions_car_rounded, label: 'الرحلات', route: '/admin/trips', currentPath: path),
          _NavTile(icon: Icons.gavel_rounded, label: 'النزاعات', route: '/admin/disputes', currentPath: path),
          _NavTile(icon: Icons.account_balance_wallet_rounded, label: 'السحوبات', route: '/admin/withdrawals', currentPath: path),
          _NavTile(icon: Icons.settings_rounded, label: 'الإعدادات', route: '/admin/config', currentPath: path),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.home_rounded),
            title: const Text('العودة للتطبيق'),
            onTap: () {
              Navigator.pop(context);
              context.go('/search');
            },
          ),
        ],
      ),
    );
  }
}

class _NavTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String route;
  final String currentPath;
  final bool exact;

  const _NavTile({
    required this.icon,
    required this.label,
    required this.route,
    required this.currentPath,
    this.exact = false,
  });

  bool get _selected => exact
      ? currentPath == route
      : currentPath == route || currentPath.startsWith('$route/');

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(label),
      selected: _selected,
      selectedTileColor:
          Theme.of(context).colorScheme.primaryContainer.withOpacity(0.4),
      onTap: () {
        Navigator.pop(context);
        if (!_selected) context.go(route);
      },
    );
  }
}
