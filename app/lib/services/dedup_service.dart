import 'package:shared_preferences/shared_preferences.dart';

/// 클라이언트 중복 수신 방지 (QoS L2)
/// message_id 기반으로 이미 처리한 메시지를 필터링
class DedupService {
  static const String _prefix = 'dedup_';
  static const int _maxEntries = 1000;

  /// 메시지가 중복인지 확인하고, 아니면 등록
  /// Returns true if this is a NEW message (not duplicate)
  Future<bool> checkAndMark(String messageId) async {
    final prefs = await SharedPreferences.getInstance();
    final key = '$_prefix$messageId';

    if (prefs.containsKey(key)) {
      // 이미 처리한 메시지
      return false;
    }

    // 새 메시지 등록
    await prefs.setInt(key, DateTime.now().millisecondsSinceEpoch);

    // 오래된 항목 정리
    await _cleanup(prefs);

    return true;
  }

  /// 오래된 중복 방지 항목 정리 (최대 _maxEntries 유지)
  Future<void> _cleanup(SharedPreferences prefs) async {
    final keys = prefs.getKeys().where((k) => k.startsWith(_prefix)).toList();

    if (keys.length <= _maxEntries) return;

    // 타임스탬프 기준 정렬하여 오래된 것부터 삭제
    final entries = <MapEntry<String, int>>[];
    for (final key in keys) {
      final ts = prefs.getInt(key) ?? 0;
      entries.add(MapEntry(key, ts));
    }
    entries.sort((a, b) => a.value.compareTo(b.value));

    final toRemove = entries.length - _maxEntries;
    for (int i = 0; i < toRemove; i++) {
      await prefs.remove(entries[i].key);
    }
  }

  /// 전체 중복 방지 캐시 초기화
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    final keys = prefs.getKeys().where((k) => k.startsWith(_prefix)).toList();
    for (final key in keys) {
      await prefs.remove(key);
    }
  }
}
