class Dispute {
  final String id;
  final String bookingId;
  final String tripId;
  final String openedByUserId;
  final String reason;
  final String description;
  final List<String> evidenceUrls;
  final String? otherPartyResponse;
  final List<String> otherPartyEvidenceUrls;
  final String status;
  final String? assignedAdminId;
  final String? resolutionNotes;
  final double? refundAmount;
  final DateTime? resolvedAt;
  final DateTime? slaDeadline;
  final DateTime createdAt;

  const Dispute({
    required this.id,
    required this.bookingId,
    required this.tripId,
    required this.openedByUserId,
    required this.reason,
    required this.description,
    required this.evidenceUrls,
    this.otherPartyResponse,
    required this.otherPartyEvidenceUrls,
    required this.status,
    this.assignedAdminId,
    this.resolutionNotes,
    this.refundAmount,
    this.resolvedAt,
    this.slaDeadline,
    required this.createdAt,
  });

  bool get isOpen => status == 'open' || status == 'under_review';
  bool get isResolved =>
      status == 'resolved_refund' || status == 'resolved_release' || status == 'resolved_split';

  String get statusLabel => switch (status) {
        'open' => 'مفتوح',
        'under_review' => 'تحت المراجعة',
        'resolved_refund' => 'تم الاسترداد',
        'resolved_release' => 'تم الإفراج',
        'resolved_split' => 'تقسيم المبلغ',
        'closed' => 'مغلق',
        _ => status,
      };

  factory Dispute.fromJson(Map<String, dynamic> json) => Dispute(
        id: json['id'] as String,
        bookingId: json['bookingId'] as String? ?? '',
        tripId: json['tripId'] as String? ?? '',
        openedByUserId: json['openedByUserId'] as String? ?? '',
        reason: json['reason'] as String? ?? '',
        description: json['description'] as String? ?? '',
        evidenceUrls:
            (json['evidenceUrls'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
        otherPartyResponse: json['otherPartyResponse'] as String?,
        otherPartyEvidenceUrls: (json['otherPartyEvidenceUrls'] as List<dynamic>?)
                ?.map((e) => e.toString())
                .toList() ??
            [],
        status: json['status'] as String? ?? 'open',
        assignedAdminId: json['assignedAdminId'] as String?,
        resolutionNotes: json['resolutionNotes'] as String?,
        refundAmount: (json['refundAmount'] as num?)?.toDouble(),
        resolvedAt: DateTime.tryParse(json['resolvedAt'] as String? ?? ''),
        slaDeadline: DateTime.tryParse(json['slaDeadline'] as String? ?? ''),
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
      );
}
