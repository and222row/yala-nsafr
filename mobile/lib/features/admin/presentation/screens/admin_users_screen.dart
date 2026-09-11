import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../widgets/admin_scaffold.dart';

class AdminUsersScreen extends ConsumerStatefulWidget {
  const AdminUsersScreen({super.key});

  @override
  ConsumerState<AdminUsersScreen> createState() => _AdminUsersScreenState();
}

class _AdminUsersScreenState extends ConsumerState<AdminUsersScreen> {
  final _searchCtrl = TextEditingController();
  String? _status;
  bool? _pendingId;
  bool? _pendingDriver;
  int _page = 1;
  static const _limit = 20;

  List<Map<String, dynamic>> _users = [];
  int _total = 0;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) {
      _page = 1;
      _users = [];
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final params = <String, dynamic>{
        'page': _page,
        'limit': _limit,
        if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
        if (_status != null) 'status': _status,
        if (_pendingId == true) 'idVerified': 'false',
        if (_pendingDriver == true) 'driverVerified': 'false',
      };
      final resp = await ref.read(dioProvider).get('/admin/users', queryParameters: params);
      final data = resp.data as Map<String, dynamic>;
      setState(() {
        if (reset) _users = [];
        _users = [
          ..._users,
          ...((data['data'] as List?)?.cast<Map<String, dynamic>>() ?? []),
        ];
        _total = (data['total'] as num?)?.toInt() ?? 0;
      });
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _doAction(String url, {Map<String, dynamic>? body}) async {
    try {
      if (body != null) {
        await ref.read(dioProvider).patch(url, data: body);
      } else {
        await ref.read(dioProvider).post(url);
      }
      _load(reset: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        visualDensity: VisualDensity.compact,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasMore = _page * _limit < _total;

    return AdminScaffold(
      title: 'المستخدمون${_total > 0 ? ' ($_total)' : ''}',
      body: Column(
        children: [
          // ── Filters ───────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'بحث بالاسم أو الهاتف...',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchCtrl.clear();
                          _load(reset: true);
                        })
                    : null,
                isDense: true,
              ),
              onSubmitted: (_) => _load(reset: true),
              onChanged: (v) {
                if (v.isEmpty) _load(reset: true);
                setState(() {}); // refresh suffix icon
              },
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                _chip('الكل', _status == null && _pendingId != true && _pendingDriver != true, () {
                  setState(() { _status = null; _pendingId = null; _pendingDriver = null; });
                  _load(reset: true);
                }),
                _chip('نشط', _status == 'active', () {
                  setState(() => _status = _status == 'active' ? null : 'active');
                  _load(reset: true);
                }),
                _chip('موقوف', _status == 'suspended', () {
                  setState(() => _status = _status == 'suspended' ? null : 'suspended');
                  _load(reset: true);
                }),
                _chip('محظور', _status == 'banned', () {
                  setState(() => _status = _status == 'banned' ? null : 'banned');
                  _load(reset: true);
                }),
                _chip('هوية معلقة', _pendingId == true, () {
                  setState(() => _pendingId = _pendingId == true ? null : true);
                  _load(reset: true);
                }),
                _chip('سائق معلق', _pendingDriver == true, () {
                  setState(() => _pendingDriver = _pendingDriver == true ? null : true);
                  _load(reset: true);
                }),
              ],
            ),
          ),
          const SizedBox(height: 4),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          // ── List ──────────────────────────────────────────────────────────
          Expanded(
            child: _loading && _users.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    onRefresh: () => _load(reset: true),
                    child: ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: _users.length + (hasMore || _loading ? 1 : 0),
                      separatorBuilder: (_, __) => const SizedBox(height: 6),
                      itemBuilder: (_, i) {
                        if (i == _users.length) {
                          return _loading
                              ? const Center(
                                  child: Padding(
                                    padding: EdgeInsets.all(16),
                                    child: CircularProgressIndicator(),
                                  ),
                                )
                              : Center(
                                  child: TextButton(
                                    onPressed: () {
                                      setState(() => _page++);
                                      _load();
                                    },
                                    child: const Text('تحميل المزيد'),
                                  ),
                                );
                        }
                        final u = _users[i];
                        return _UserCard(
                          user: u,
                          onView: () => context.push('/users/${u['id']}'),
                          onApproveId: u['idVerificationPending'] == true
                              ? () => _doAction(
                                  '/admin/users/${u['id']}/verify-id/approve')
                              : null,
                          onApproveDriver: u['driverVerificationPending'] == true
                              ? () => _doAction(
                                  '/admin/users/${u['id']}/verify-driver/approve')
                              : null,
                          onSetStatus: (s) => _doAction(
                            '/admin/users/${u['id']}/status',
                            body: {'status': s},
                          ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

// ── User card ─────────────────────────────────────────────────────────────────

class _UserCard extends StatelessWidget {
  final Map<String, dynamic> user;
  final VoidCallback onView;
  final VoidCallback? onApproveId;
  final VoidCallback? onApproveDriver;
  final void Function(String) onSetStatus;

  const _UserCard({
    required this.user,
    required this.onView,
    required this.onApproveId,
    required this.onApproveDriver,
    required this.onSetStatus,
  });

  Color get _statusColor {
    return switch (user['status'] as String? ?? '') {
      'active' => Colors.green,
      'suspended' => Colors.orange,
      'banned' => Colors.red,
      _ => Colors.grey,
    };
  }

  String get _statusLabel {
    return switch (user['status'] as String? ?? '') {
      'active' => 'نشط',
      'suspended' => 'موقوف',
      'banned' => 'محظور',
      _ => user['status'] as String? ?? '',
    };
  }

  @override
  Widget build(BuildContext context) {
    final status = user['status'] as String? ?? 'active';
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(user['fullName'] as String? ?? '-',
                          style: const TextStyle(fontWeight: FontWeight.bold)),
                      Text(user['phoneNumber'] as String? ?? '',
                          style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: _statusColor.withOpacity(0.1),
                    border: Border.all(color: _statusColor),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(_statusLabel,
                      style: TextStyle(
                          color: _statusColor,
                          fontSize: 11,
                          fontWeight: FontWeight.w600)),
                ),
                PopupMenuButton<String>(
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'view', child: Text('عرض الملف')),
                    if (onApproveId != null)
                      const PopupMenuItem(value: 'id', child: Text('✅ تأكيد الهوية')),
                    if (onApproveDriver != null)
                      const PopupMenuItem(value: 'driver', child: Text('✅ تأكيد السائق')),
                    if (status != 'active')
                      const PopupMenuItem(value: 'activate', child: Text('تنشيط')),
                    if (status != 'suspended')
                      const PopupMenuItem(value: 'suspend', child: Text('إيقاف مؤقت')),
                    if (status != 'banned')
                      const PopupMenuItem(value: 'ban', child: Text('حظر')),
                  ],
                  onSelected: (v) {
                    switch (v) {
                      case 'view':
                        onView();
                      case 'id':
                        onApproveId?.call();
                      case 'driver':
                        onApproveDriver?.call();
                      case 'activate':
                        onSetStatus('active');
                      case 'suspend':
                        onSetStatus('suspended');
                      case 'ban':
                        onSetStatus('banned');
                    }
                  },
                ),
              ],
            ),
            if (user['idVerificationPending'] == true ||
                user['driverVerificationPending'] == true) ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                children: [
                  if (user['idVerificationPending'] == true)
                    _Pill(label: 'هوية معلقة', color: Colors.purple),
                  if (user['driverVerificationPending'] == true)
                    _Pill(label: 'سائق معلق', color: Colors.teal),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String label;
  final Color color;
  const _Pill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}
