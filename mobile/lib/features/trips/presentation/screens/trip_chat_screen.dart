import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/models/chat_message.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../providers/messages_provider.dart';

class TripChatScreen extends ConsumerStatefulWidget {
  final String tripId;
  final String tripLabel;
  const TripChatScreen({
    super.key,
    required this.tripId,
    required this.tripLabel,
  });

  @override
  ConsumerState<TripChatScreen> createState() => _TripChatScreenState();
}

class _TripChatScreenState extends ConsumerState<TripChatScreen> {
  final _textCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  Timer? _pollTimer;
  bool _sending = false;
  // optimistic messages inserted before server confirms
  final List<ChatMessage> _pending = [];

  @override
  void initState() {
    super.initState();
    _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mounted) ref.invalidate(tripMessagesProvider(widget.tripId));
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _textCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _scrollToBottom({bool animated = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollCtrl.hasClients) return;
      if (animated) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      } else {
        _scrollCtrl.jumpTo(_scrollCtrl.position.maxScrollExtent);
      }
    });
  }

  Future<void> _send() async {
    final text = _textCtrl.text.trim();
    if (text.isEmpty || _sending) return;

    final me = ref.read(authProvider).user;
    if (me == null) return;

    // Optimistic update
    final optimistic = ChatMessage(
      id: 'pending-${DateTime.now().millisecondsSinceEpoch}',
      tripId: widget.tripId,
      senderId: me.id,
      senderName: me.fullName.isNotEmpty ? me.fullName : me.phoneNumber,
      body: text,
      createdAt: DateTime.now(),
    );
    setState(() {
      _pending.add(optimistic);
      _sending = true;
    });
    _textCtrl.clear();
    _scrollToBottom();

    try {
      await sendChatMessage(ref, widget.tripId, text);
      setState(() => _pending.remove(optimistic));
      ref.invalidate(tripMessagesProvider(widget.tripId));
      _scrollToBottom();
    } catch (e) {
      setState(() => _pending.remove(optimistic));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('فشل الإرسال: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(tripMessagesProvider(widget.tripId));
    final myId = ref.watch(authProvider).user?.id ?? '';

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('مجموعة الرحلة', style: TextStyle(fontSize: 16)),
            Text(widget.tripLabel,
                style:
                    const TextStyle(fontSize: 12, color: Colors.white70)),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: messagesAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.lock_outline_rounded,
                        size: 52, color: Colors.grey),
                    const SizedBox(height: 12),
                    Text(
                      e.toString().contains('403')
                          ? 'لا يمكنك الوصول لهذا الدردشة\nيجب أن يكون لديك حجز مؤكد'
                          : '$e',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.grey),
                    ),
                  ],
                ),
              ),
              data: (messages) {
                final all = [...messages, ..._pending];
                if (all.isEmpty) {
                  return const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.chat_bubble_outline_rounded,
                            size: 56, color: Colors.grey),
                        SizedBox(height: 12),
                        Text(
                          'لا توجد رسائل بعد\nكن أول من يبدأ المحادثة!',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.grey),
                        ),
                      ],
                    ),
                  );
                }
                _scrollToBottom(animated: false);
                return ListView.builder(
                  controller: _scrollCtrl,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
                  itemCount: all.length,
                  itemBuilder: (_, i) {
                    final msg = all[i];
                    final isMe = msg.senderId == myId;
                    final isPending = msg.id.startsWith('pending-');
                    final showName = !isMe &&
                        (i == 0 || all[i - 1].senderId != msg.senderId);
                    final showTime = i == all.length - 1 ||
                        all[i + 1].senderId != msg.senderId ||
                        all[i + 1].createdAt
                                .difference(msg.createdAt)
                                .inMinutes >
                            5;

                    return _MessageBubble(
                      msg: msg,
                      isMe: isMe,
                      isPending: isPending,
                      showName: showName,
                      showTime: showTime,
                    );
                  },
                );
              },
            ),
          ),
          _InputBar(
            controller: _textCtrl,
            sending: _sending,
            onSend: _send,
          ),
        ],
      ),
    );
  }
}

// ── Message bubble ────────────────────────────────────────────────────────────

class _MessageBubble extends StatelessWidget {
  final ChatMessage msg;
  final bool isMe;
  final bool isPending;
  final bool showName;
  final bool showTime;

  const _MessageBubble({
    required this.msg,
    required this.isMe,
    required this.isPending,
    required this.showName,
    required this.showTime,
  });

  @override
  Widget build(BuildContext context) {
    final bubbleColor =
        isMe ? AppColors.primary : Colors.grey.shade200;
    final textColor = isMe ? Colors.white : Colors.black87;
    final align =
        isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    final bubbleRadius = BorderRadius.only(
      topLeft: const Radius.circular(18),
      topRight: const Radius.circular(18),
      bottomLeft: Radius.circular(isMe ? 18 : 4),
      bottomRight: Radius.circular(isMe ? 4 : 18),
    );

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(
        crossAxisAlignment: align,
        children: [
          if (showName)
            Padding(
              padding: const EdgeInsets.only(bottom: 3, left: 4, right: 4),
              child: Text(
                msg.senderName,
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey[600]),
              ),
            ),
          Row(
            mainAxisAlignment:
                isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (!isMe)
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 2),
                  child: CircleAvatar(
                    radius: 14,
                    backgroundColor: AppColors.primary.withOpacity(0.12),
                    child: Text(
                      msg.senderName.isNotEmpty ? msg.senderName[0] : '؟',
                      style: const TextStyle(
                          fontSize: 11, color: AppColors.primary),
                    ),
                  ),
                ),
              Flexible(
                child: Container(
                  margin: EdgeInsets.only(
                    left: isMe ? 60 : 6,
                    right: isMe ? 6 : 60,
                  ),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: bubbleColor,
                    borderRadius: bubbleRadius,
                  ),
                  child: Text(
                    msg.body,
                    style: TextStyle(color: textColor, fontSize: 15),
                  ),
                ),
              ),
              if (isMe && isPending)
                Padding(
                  padding: const EdgeInsets.only(right: 4, bottom: 2),
                  child: SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(
                        strokeWidth: 1.5,
                        color: Colors.grey[400]),
                  ),
                ),
            ],
          ),
          if (showTime)
            Padding(
              padding: const EdgeInsets.only(top: 3, bottom: 8, left: 4, right: 4),
              child: Text(
                _fmt(msg.createdAt),
                style: TextStyle(fontSize: 11, color: Colors.grey[500]),
              ),
            ),
        ],
      ),
    );
  }

  String _fmt(DateTime dt) {
    final now = DateTime.now();
    final isToday = dt.year == now.year &&
        dt.month == now.month &&
        dt.day == now.day;
    final time =
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    if (isToday) return time;
    return '${dt.day}/${dt.month} $time';
  }
}

// ── Input bar ─────────────────────────────────────────────────────────────────

class _InputBar extends StatelessWidget {
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;

  const _InputBar({
    required this.controller,
    required this.sending,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border:
              Border(top: BorderSide(color: Colors.grey.shade200)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                textInputAction: TextInputAction.newline,
                maxLines: 4,
                minLines: 1,
                maxLength: 1000,
                decoration: InputDecoration(
                  hintText: 'اكتب رسالة…',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  filled: true,
                  fillColor: Colors.grey.shade100,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 10),
                  counterText: '',
                ),
              ),
            ),
            const SizedBox(width: 6),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              child: sending
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : IconButton.filled(
                      icon: const Icon(Icons.send_rounded),
                      onPressed: onSend,
                      style: IconButton.styleFrom(
                          backgroundColor: AppColors.primary),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
