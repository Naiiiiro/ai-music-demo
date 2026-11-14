"""節奏型態：Euclidean rhythm（把 k 個擊點盡量平均分配到 n 格）。"""


def euclidean_rhythm(pulse_count: int, step_count: int) -> tuple[bool, ...]:
    """產生 Euclidean rhythm。

    例如 (3, 8) 會得到拉丁音樂的 tresillo：x..x..x.

    參數：
        pulse_count: 擊點數 k，0 ≤ k ≤ n。
        step_count: 總格數 n，必須 > 0。
    回傳：
        長度 n 的布林序列，True 代表該格有擊點，第 0 格固定為擊點（k > 0 時）。
    """
    if step_count <= 0:
        raise ValueError(f"step_count 必須 > 0，收到 {step_count}")
    if not 0 <= pulse_count <= step_count:
        raise ValueError(f"pulse_count 必須在 0–{step_count}，收到 {pulse_count}")
    # Bresenham 直線演算法：與 Bjorklund 結果相同（差一個旋轉），且實作簡單
    return tuple(
        (step_index * pulse_count) % step_count < pulse_count for step_index in range(step_count)
    )
