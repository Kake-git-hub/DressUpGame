/**
 * DressUpMenu コンポーネント
 * 背景はボタン切り替えで別画面、服はフォルダ名でグループ化して表示
 * 左側にスクロール用スペースを配置（誤ドラッグ防止）
 */
import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import type { CSSProperties } from 'react';
import type { ClothingItemData, ClothingType, DollData, BackgroundData, Position } from '../types';

interface DressUpMenuProps {
  items: ClothingItemData[];
  onItemDrop: (item: ClothingItemData) => void;
  equippedItems: ClothingItemData[];
  dolls: DollData[];
  currentDollId: string;
  onDollChange: (dollId: string) => void;
  dropTargetId: string;
  backgrounds?: BackgroundData[];
  currentBackgroundId?: string | null;
  onBackgroundChange?: (backgroundId: string | null) => void;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
  onBackgroundDragMove?: (bg: BackgroundData, position: Position) => void;
  onBackgroundDragEnd?: () => void;
}

export function DressUpMenu({
  items,
  onItemDrop,
  equippedItems,
  dolls,
  currentDollId,
  onDollChange,
  dropTargetId,
  backgrounds = [],
  currentBackgroundId = null,
  onBackgroundChange,
  onDragMove,
  onDragEnd,
  onBackgroundDragMove,
  onBackgroundDragEnd,
}: DressUpMenuProps) {
  // 背景選択画面の表示状態
  const [showBackgrounds, setShowBackgrounds] = useState(false);
  
  // 現在選択中のカテゴリ（横画面用）
  const [selectedCategoryLandscape, setSelectedCategoryLandscape] = useState<string | null>(null);
  
  // スクロール用ref

  // 装備中のアイテムIDをセット化
  const equippedIds = useMemo(() => new Set(equippedItems.map(i => i.id)), [equippedItems]);

  // 装備中のタイプをセット化
  const equippedTypes = useMemo(() => new Set(equippedItems.map(i => i.type)), [equippedItems]);

  // アイテムをフォルダ名(type)でグループ化（元の順序を保持）
  const groupedItems = useMemo(() => {
    const groups = new Map<string, { items: ClothingItemData[]; categoryOrder: number; layerOrder: number }>();
    
    items.forEach(item => {
      // うしろがみは、髪の 1 点と一緒に付く。メニューには出さない
      if (item.frontItemId) return;
      const key = item.type;
      if (!groups.has(key)) {
        groups.set(key, { 
          items: [], 
          categoryOrder: item.categoryOrder ?? 999,
          layerOrder: item.layerOrder ?? item.baseZIndex ?? 999 
        });
      }
      groups.get(key)!.items.push(item);
    });
    
    // categoryOrder順でソート（categoryOrderがない場合はlayerOrder順）
    const sorted = Array.from(groups.entries()).sort((a, b) => {
      // まずcategoryOrderで比較
      const catOrderDiff = a[1].categoryOrder - b[1].categoryOrder;
      if (catOrderDiff !== 0) return catOrderDiff;
      // categoryOrderが同じ場合はlayerOrderで比較
      return a[1].layerOrder - b[1].layerOrder;
    });
    
    return new Map(sorted.map(([key, val]) => [key, val.items]));
  }, [items]);

  // カテゴリ一覧
  const categories = useMemo(() => Array.from(groupedItems.keys()), [groupedItems]);
  
  // 選択中カテゴリのアイテム（横画面用）
  const selectedCategoryItemsLandscape = useMemo(() => {
    if (!selectedCategoryLandscape) return [];
    return groupedItems.get(selectedCategoryLandscape) ?? [];
  }, [selectedCategoryLandscape, groupedItems]);

  // 背景選択画面（横画面）
  if (showBackgrounds) {
    return (
      <div style={styles.outerContainer}>
        <div style={styles.container}>
          {/* 戻るボタン */}
          <button 
            style={styles.backButton} 
            onClick={() => setShowBackgrounds(false)}
          >
            ← もどる
          </button>

          {/* 背景の「なし」ボタン（背景選択中の場合） */}
          {currentBackgroundId !== null && (
            <button
              style={styles.categoryRemoveButton}
              onClick={() => onBackgroundChange?.(null)}
            >
              ✕ なし
            </button>
          )}

          {/* スクロール可能な背景リスト */}
          <ScrollList>
            <div style={styles.scrollContent}>
              {backgrounds.map(bg => (
                <DraggableBackground
                  key={bg.id}
                  bg={bg}
                  isSelected={currentBackgroundId === bg.id}
                  onDrop={onBackgroundChange!}
                  dropTargetId={dropTargetId}
                  onDragMove={onBackgroundDragMove}
                  onDragEnd={onBackgroundDragEnd}
                />
              ))}

              {backgrounds.length === 0 && (
                <p style={styles.emptyMessage}>
                  背景がありません<br />
                  設定からプリセットを取り込んでください
                </p>
              )}
            </div>
          </ScrollList>
        </div>
      </div>
    );
  }

  // カテゴリ内アイテム表示（横画面）
  if (selectedCategoryLandscape) {
    return (
      <div style={styles.outerContainer}>
        <div style={styles.container}>
          {/* 戻るボタン */}
          <button 
            style={styles.backButton} 
            onClick={() => setSelectedCategoryLandscape(null)}
          >
            ← もどる
          </button>
          
          {/* スクロール可能なアイテムリスト */}
          <ScrollList>
            <div style={styles.scrollContent}>
              {selectedCategoryItemsLandscape.map(item => (
                <DraggableItem
                  key={item.id}
                  item={item}
                  isEquipped={equippedIds.has(item.id)}
                  onDrop={onItemDrop}
                  dropTargetId={dropTargetId}
                  onDragMove={onDragMove}
                  onDragEnd={onDragEnd}
                />
              ))}
            </div>
          </ScrollList>
        </div>
      </div>
    );
  }

  // メインメニュー（カテゴリ一覧 - 横画面）
  return (
    <div style={styles.outerContainer}>
      <div style={styles.container}>
        {/* ヘッダー：ドール選択 */}
        <div style={styles.menuHeader}>
          <select
            style={styles.dollSelect}
            value={currentDollId}
            onChange={(e) => onDollChange(e.target.value)}
            disabled={dolls.length === 0}
          >
            {dolls.length === 0 ? (
              <option value="">ドールなし</option>
            ) : (
              dolls.map(doll => (
                <option key={doll.id} value={doll.id}>
                  {doll.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* スクロール可能なカテゴリリスト */}
        <ScrollList>
          <div style={styles.scrollContent}>
            {/* 背景ボタン（カテゴリと同じサイズ） */}
            {backgrounds.length > 0 && (
              <button
                style={{
                  ...styles.categoryButton,
                  ...(currentBackgroundId ? styles.categoryButtonEquipped : {}),
                }}
                onClick={() => setShowBackgrounds(true)}
              >
                <div style={styles.categoryThumbnail}>
                  <span style={{ fontSize: '28px' }}>🖼️</span>
                  {currentBackgroundId && (
                    <div style={styles.categoryEquippedBadge}>✓</div>
                  )}
                </div>
                <span style={styles.categoryButtonLabel}>はいけい</span>
              </button>
            )}

            {categories.map(category => {
              const categoryItems = groupedItems.get(category) ?? [];
              const firstItem = categoryItems[0];
              const hasEquipped = equippedTypes.has(category as ClothingType);
              
              return (
                <button
                  key={category}
                  style={{
                    ...styles.categoryButton,
                    ...(hasEquipped ? styles.categoryButtonEquipped : {}),
                  }}
                  onClick={() => setSelectedCategoryLandscape(category)}
                >
                  {/* サムネイル（先頭アイテム） */}
                  <div style={styles.categoryThumbnail}>
                    {firstItem && (
                      <img
                        src={firstItem.thumbnailUrl || firstItem.imageUrl}
                        alt={category}
                        style={styles.categoryThumbnailImage}
                        draggable={false}
                        loading="lazy"
                      />
                    )}
                    {hasEquipped && (
                      <div style={styles.categoryEquippedBadge}>✓</div>
                    )}
                  </div>
                  {/* カテゴリ名 */}
                  <span style={styles.categoryButtonLabel}>{category}</span>
                </button>
              );
            })}

            {items.length === 0 && (
              <p style={styles.emptyMessage}>
                まだ ふくが ありません
              </p>
            )}
          </div>
        </ScrollList>
      </div>
    </div>
  );
}

// ドラッグ可能なアイテムコンポーネント（メモ化で再レンダリング軽減）
interface DraggableItemProps {
  item: ClothingItemData;
  isEquipped: boolean;
  onDrop: (item: ClothingItemData) => void;
  dropTargetId: string;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
}

const DraggableItem = memo(function DraggableItem({ item, isEquipped, onDrop, dropTargetId, onDragMove, onDragEnd }: DraggableItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const movedDistance = useRef(0);
  const elementRef = useRef<HTMLDivElement>(null);

  const isInsideMenu = useCallback((clientX: number, clientY: number): boolean => {
    const menu = document.querySelector('.palette-section');
    if (!menu) return false;
    const rect = (menu as HTMLElement).getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }, []);

  const checkIsOverTarget = useCallback((clientX: number, clientY: number): boolean => {
    const targetElement = document.querySelector(`[data-testid="${dropTargetId}"]`);
    if (!targetElement) return false;
    const rect = targetElement.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && 
           clientY >= rect.top && clientY <= rect.bottom;
  }, [dropTargetId]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    setDragPos({ x: 0, y: 0 });
    movedDistance.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    movedDistance.current = Math.max(movedDistance.current, Math.hypot(dx, dy));
    setDragPos({ x: dx, y: dy });
    if (onDragMove) {
      onDragMove(item, { x: e.clientX, y: e.clientY });
    }
  }, [isDragging, item, onDragMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragPos({ x: 0, y: 0 });
    onDragEnd?.();

    // タップ（ほぼ移動なし）は装着しない
    if (movedDistance.current < 10) {
      return;
    }

    // メニュー領域上で指を離した場合は装着しない（キャンバスが背面にあっても誤判定を防ぐ）
    if (isInsideMenu(e.clientX, e.clientY)) {
      return;
    }

    if (checkIsOverTarget(e.clientX, e.clientY)) {
      onDrop(item);
    }
  }, [isDragging, checkIsOverTarget, onDrop, item, onDragEnd, isInsideMenu]);

  return (
    <div
      ref={elementRef}
      style={{
        ...styles.itemButton,
        ...(isEquipped ? styles.itemButtonEquipped : {}),
        ...(isDragging ? styles.itemDragging : {}),
        transform: isDragging ? `translate(${dragPos.x}px, ${dragPos.y}px)` : 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setIsDragging(false);
        setDragPos({ x: 0, y: 0 });
        onDragEnd?.();
      }}
    >
      <div style={styles.itemImageContainer}>
        <img
          src={item.thumbnailUrl || item.imageUrl}
          alt={item.name}
          style={styles.itemImage}
          draggable={false}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">?</text></svg>';
          }}
        />
        {isEquipped && (
          <div style={styles.equippedBadge}>✓</div>
        )}
      </div>
    </div>
  );
});

// 背景アイテム用ドラッグコンポーネント（メモ化で再レンダリング軽減）
const DraggableBackground = memo(function DraggableBackground({
  bg,
  isSelected,
  onDrop,
  dropTargetId,
  onDragMove,
  onDragEnd,
}: {
  bg: BackgroundData;
  isSelected: boolean;
  onDrop: (bgId: string | null) => void;
  dropTargetId: string;
  onDragMove?: (bg: BackgroundData, position: Position) => void;
  onDragEnd?: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const movedDistance = useRef(0);

  const isInsideMenu = useCallback((clientX: number, clientY: number): boolean => {
    const menu = document.querySelector('[data-menu="dressup-menu"]');
    if (!menu) return false;
    const rect = (menu as HTMLElement).getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }, []);

  const checkIsOverTarget = useCallback((clientX: number, clientY: number): boolean => {
    const targetElement = document.querySelector(`[data-testid="${dropTargetId}"]`);
    if (!targetElement) return false;
    const rect = targetElement.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && 
           clientY >= rect.top && clientY <= rect.bottom;
  }, [dropTargetId]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    setDragPos({ x: 0, y: 0 });
    movedDistance.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    movedDistance.current = Math.max(movedDistance.current, Math.hypot(dx, dy));
    setDragPos({ x: dx, y: dy });
    if (onDragMove) {
      onDragMove(bg, { x: e.clientX, y: e.clientY });
    }
  }, [isDragging, bg, onDragMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragPos({ x: 0, y: 0 });
    onDragEnd?.();

    // タップ（ほぼ移動なし）も適用
    if (movedDistance.current < 10) {
      onDrop(bg.id);
      return;
    }

    // メニュー領域上で指を離した場合は適用しない
    if (isInsideMenu(e.clientX, e.clientY)) {
      return;
    }

    if (checkIsOverTarget(e.clientX, e.clientY)) {
      onDrop(bg.id);
    }
  }, [isDragging, checkIsOverTarget, onDrop, bg.id, onDragEnd, isInsideMenu]);

  return (
    <div
      style={{
        ...styles.itemButton,
        ...(isSelected ? styles.itemButtonSelected : {}),
        ...(isDragging ? styles.itemDragging : {}),
        transform: isDragging ? `translate(${dragPos.x}px, ${dragPos.y}px)` : 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setIsDragging(false);
        setDragPos({ x: 0, y: 0 });
        onDragEnd?.();
      }}
    >
      <div style={styles.itemImageContainer}>
        <img
          src={bg.thumbnailUrl || bg.imageUrl}
          alt={bg.name}
          style={styles.itemImage}
          draggable={false}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="20">🖼️</text></svg>';
          }}
        />
        {isSelected && (
          <div style={styles.equippedBadge}>✓</div>
        )}
      </div>
    </div>
  );
});

// 縦に並ぶ一覧。上下の ▲▼ で、見えている高さの 8 割ずつ動かす（指で動かすのが難しい子ども向け）
function ScrollList({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ top: true, bottom: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ top: el.scrollTop <= 2, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 });
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [update]);
  const scroll = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ top: direction * el.clientHeight * 0.8, behavior: 'smooth' });
  };
  return (
    <>
      <button style={{ ...styles.scrollButton, ...(edge.top ? styles.scrollButtonOff : {}) }} onClick={() => scroll(-1)} disabled={edge.top} aria-label="うえへ" data-testid="menu-scroll-up">
        ▲
      </button>
      <div style={styles.itemList} ref={ref} onScroll={update}>
        {children}
      </div>
      <button style={{ ...styles.scrollButton, ...(edge.bottom ? styles.scrollButtonOff : {}) }} onClick={() => scroll(1)} disabled={edge.bottom} aria-label="したへ" data-testid="menu-scroll-down">
        ▼
      </button>
    </>
  );
}

const MENU_WIDTH = 160;
const SCROLL_PADDING = 30; // 右側のスクロール用余白
const ITEM_PADDING = 4;
const ITEM_SIZE = MENU_WIDTH - SCROLL_PADDING - ITEM_PADDING * 2 - 8;

const styles: Record<string, CSSProperties> = {
  outerContainer: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    // Safari対応：vhフォールバック + dvh（CSS変数で上書き）
    // 上のバーの分（--top-inset）だけ下がるので、その分低くする（下の端に寄りすぎない）
    maxHeight: 'calc(var(--menu-vh, 100vh) - 24px - var(--top-inset, 0px))',
  },
  container: {
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
    padding: `${ITEM_PADDING}px`,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    width: `${MENU_WIDTH}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    height: '100%',
    overflow: 'hidden',
  },
  menuHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    paddingBottom: '4px',
    borderBottom: '1px solid #e9ecef',
    flexShrink: 0,
  },
  dollSelect: {
    flex: 1,
    padding: '4px 6px',
    fontSize: '11px',
    borderRadius: '6px',
    border: '2px solid #e9ecef',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  backButton: {
    width: '100%',
    padding: '12px 8px',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#666',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    flexShrink: 0,
    marginBottom: '8px',
  },
  resetButton: {
    width: '100%',
    padding: '6px',
    marginBottom: '2px',
    fontSize: '10px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  scrollButton: {
    width: '100%',
    height: '28px',
    flexShrink: 0,
    padding: 0,
    fontSize: '14px',
    lineHeight: 1,
    color: '#ff69b4',
    backgroundColor: '#fff',
    border: '2px solid #ffd1e8',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  scrollButtonOff: {
    opacity: 0.3,
    cursor: 'default',
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    overflowY: 'auto',
    flex: 1,
    WebkitOverflowScrolling: 'touch', // iOS用スムーススクロール
    paddingRight: 0,
  },
  // スクロールコンテナは全幅のまま、内容だけ右側を空ける
  scrollContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    width: `calc(100% - ${SCROLL_PADDING}px)`,
    boxSizing: 'border-box',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#333',
    padding: '6px 4px',
    marginBottom: '2px',
    borderBottom: '2px solid #ff69b4',
  },
  folderLabel: {
    fontSize: '9px',
    fontWeight: 'bold',
    color: '#666',
    padding: '4px 2px 2px',
    marginTop: '2px',
    borderBottom: '1px solid #e9ecef',
    backgroundColor: '#f0f0f0',
    borderRadius: '4px 4px 0 0',
  },
  itemButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '6px',
    transition: 'box-shadow 0.2s',
    userSelect: 'none',
    width: `${ITEM_SIZE}px`,
    height: `${ITEM_SIZE}px`,
    flexShrink: 0,
  },
  itemButtonEquipped: {
    border: '2px solid #ff69b4',
    backgroundColor: '#fff5f8',
  },
  itemButtonSelected: {
    border: '2px solid #28a745',
    backgroundColor: '#d4edda',
  },
  itemDragging: {
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.3)',
    zIndex: 1000,
    opacity: 0.9,
  },
  itemImageContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noneOverlayLabel: {
    position: 'absolute',
    bottom: '2px',
    left: '0',
    right: '0',
    textAlign: 'center',
    fontSize: '10px',
    color: '#666',
    pointerEvents: 'none',
  },
  itemImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
  },
  itemLabel: {
    fontSize: '9px',
    color: '#666',
    marginTop: '2px',
  },
  equippedBadge: {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    width: '14px',
    height: '14px',
    backgroundColor: '#ff69b4',
    color: 'white',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    fontWeight: 'bold',
  },
  removeButton: {
    width: `${ITEM_SIZE}px`,
    height: `${ITEM_SIZE}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#666',
    backgroundColor: 'white',
    border: '2px dashed #ccc',
    borderRadius: '6px',
    cursor: 'pointer',
    marginTop: '2px',
    marginBottom: '2px',
  },
  categoryRemoveButton: {
    width: '100%',
    padding: '12px 8px',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#dc3545',
    backgroundColor: '#ffe5e5',
    border: '2px solid #dc3545',
    borderRadius: '6px',
    cursor: 'pointer',
    flexShrink: 0,
    marginBottom: '4px',
  },
  categoryButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '4px',
    padding: '4px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    cursor: 'pointer',
    width: `${ITEM_SIZE}px`,
    minHeight: `${ITEM_SIZE}px`,
    flexShrink: 0,
  },
  categoryButtonEquipped: {
    border: '2px solid #ff69b4',
    backgroundColor: '#fff5f8',
  },
  categoryThumbnail: {
    position: 'relative',
    width: '100%',
    height: `${ITEM_SIZE - 24}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: '4px',
    backgroundColor: '#f8f9fa',
  },
  categoryThumbnailImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
  },
  categoryEquippedBadge: {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    width: '14px',
    height: '14px',
    backgroundColor: '#ff69b4',
    color: 'white',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    fontWeight: 'bold',
  },
  categoryButtonLabel: {
    fontSize: '9px',
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    width: '100%',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#666',
    padding: '12px',
    fontSize: '10px',
    lineHeight: 1.5,
  },
};
