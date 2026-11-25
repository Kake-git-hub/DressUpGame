/**
 * DressUpMenu コンポーネント
 * 背景はボタン切り替えで別画面、服はフォルダ名でグループ化して表示
 * 左側にスクロール用スペースを配置（誤ドラッグ防止）
 */
import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import type { CSSProperties } from 'react';
import type { ClothingItemData, ClothingType, DollData, BackgroundData, Position } from '../types';
import { menuSets, setsIndex } from './menuSets';
import type { MenuSet } from './menuSets';

interface DressUpMenuProps {
  items: ClothingItemData[];
  onItemDrop: (item: ClothingItemData) => void;
  // 着ている服のタイルをタップ（ほとんど動かさずに離す）したとき。脱がせる（セットは、パーツを全部）
  onItemRemove?: (items: ClothingItemData[]) => void;
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
  // 縦画面では、画面の下に「カテゴリの行」と「服の行（itemRows 段）」を横に流して並べる
  layout?: 'landscape' | 'portrait';
  itemRows?: number;
  itemTile?: number; // 縦画面の、服の絵の一辺（px）
  // セット（同じテーマで一度に作った服の集まり）をドールへ運んだとき。パーツを全部着せる
  onSetDrop?: (items: ClothingItemData[]) => void;
  // メニューでの「セット」の位置（素材の一覧のドールの setsOrder。カテゴリの並び順と同じ数え方）。無ければ先頭
  setsOrder?: number;
}

// メニューの「セット」。カテゴリの名前とは別物（同じ名前のカテゴリがあっても混ざらない）
const SET_CATEGORY = '__set';
const DEFAULT_PORTRAIT_TILE = 72; // 縦画面の絵の一辺の既定（ふつうは、配置の計算が決めた値が渡る）
const SET_LABEL = 'セット';

export function DressUpMenu({
  items,
  onItemDrop,
  onItemRemove,
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
  layout = 'landscape',
  itemRows = 1,
  itemTile = DEFAULT_PORTRAIT_TILE,
  onSetDrop,
  setsOrder,
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

  // セット: 入っているセットごとにまとめる（1 点がいくつものセットに入っていてもよい）
  const sets = useMemo(() => menuSets(items), [items]);
  // 「セット」を、並べたカテゴリの何番めの前に出すか
  const setsAt = useMemo(() => setsIndex(categories.map((c) => groupedItems.get(c)?.[0]?.categoryOrder ?? 999), setsOrder), [categories, groupedItems, setsOrder]);
  // カテゴリの並びに「セット」を入れたもの（セットがあるときだけ）
  const menuOrder = useMemo(() => (sets.length > 0 ? [...categories.slice(0, setsAt), SET_CATEGORY, ...categories.slice(setsAt)] : categories), [categories, sets.length, setsAt]);
  const isSetWorn = (set: MenuSet) => set.items.every((i) => equippedIds.has(i.id));
  const dropSet = onSetDrop ?? (() => {});
  
  // 選択中カテゴリのアイテム（横画面用）
  const selectedCategoryItemsLandscape = useMemo(() => {
    if (!selectedCategoryLandscape) return [];
    return groupedItems.get(selectedCategoryLandscape) ?? [];
  }, [selectedCategoryLandscape, groupedItems]);

  // 縦画面: カテゴリの行はいつも出ていて、選んだカテゴリの服がその下に並ぶ
  if (layout === 'portrait') {
    return (
      <PortraitMenu
        groupedItems={groupedItems}
        menuOrder={menuOrder}
        sets={sets}
        onSetDrop={dropSet}
        equippedIds={equippedIds}
        equippedTypes={equippedTypes}
        itemRows={itemRows}
        itemTile={itemTile}
        onItemDrop={onItemDrop}
        onItemRemove={onItemRemove}
        dolls={dolls}
        currentDollId={currentDollId}
        onDollChange={onDollChange}
        dropTargetId={dropTargetId}
        backgrounds={backgrounds}
        currentBackgroundId={currentBackgroundId}
        onBackgroundChange={onBackgroundChange}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onBackgroundDragMove={onBackgroundDragMove}
        onBackgroundDragEnd={onBackgroundDragEnd}
      />
    );
  }

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

  // セットの一覧（横画面）
  if (selectedCategoryLandscape === SET_CATEGORY && sets.length > 0) {
    return (
      <div style={styles.outerContainer}>
        <div style={styles.container}>
          <button style={styles.backButton} onClick={() => setSelectedCategoryLandscape(null)}>
            ← もどる
          </button>
          <ScrollList>
            <div style={styles.scrollContent}>
              {sets.map((set) => (
                <DraggableSet key={set.id} set={set} isWorn={isSetWorn(set)} onDrop={dropSet} dropTargetId={dropTargetId} onDragMove={onDragMove} onDragEnd={onDragEnd} />
              ))}
            </div>
          </ScrollList>
        </div>
      </div>
    );
  }

  // カテゴリ内アイテム表示（横画面）
  if (selectedCategoryLandscape && selectedCategoryLandscape !== SET_CATEGORY) {
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
                  onRemove={onItemRemove}
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

            {/* セット（あるドールだけ。位置は素材の一覧で決める。無ければ服のカテゴリより前） */}
            {menuOrder.map(category => {
              if (category === SET_CATEGORY) return (
              <button
                key={SET_CATEGORY}
                style={{ ...styles.categoryButton, ...(sets.some(isSetWorn) ? styles.categoryButtonEquipped : {}) }}
                onClick={() => setSelectedCategoryLandscape(SET_CATEGORY)}
              >
                <div style={styles.categoryThumbnail}>
                  <div style={styles.setMosaic}>
                    {sets[0].items.slice(0, 4).map((item) => (
                      <img key={item.id} src={item.thumbnailUrl || item.imageUrl} alt="" style={styles.setMosaicImage} draggable={false} loading="lazy" />
                    ))}
                  </div>
                  {sets.some(isSetWorn) && <div style={styles.categoryEquippedBadge}>✓</div>}
                </div>
                <span style={styles.categoryButtonLabel}>{SET_LABEL}</span>
              </button>
              );
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
// 縦画面の、下のメニュー
const PORTRAIT_BACKGROUND = '__background';


interface PortraitMenuProps {
  groupedItems: Map<string, ClothingItemData[]>;
  menuOrder: string[]; // カテゴリの並びに「セット」（SET_CATEGORY）を入れたもの
  sets: MenuSet[];
  onSetDrop: (items: ClothingItemData[]) => void;
  equippedIds: Set<string>;
  equippedTypes: Set<string>;
  itemRows: number;
  itemTile: number;
  onItemDrop: (item: ClothingItemData) => void;
  onItemRemove?: (items: ClothingItemData[]) => void;
  dolls: DollData[];
  currentDollId: string;
  onDollChange: (dollId: string) => void;
  dropTargetId: string;
  backgrounds: BackgroundData[];
  currentBackgroundId: string | null;
  onBackgroundChange?: (backgroundId: string | null) => void;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
  onBackgroundDragMove?: (bg: BackgroundData, position: Position) => void;
  onBackgroundDragEnd?: () => void;
}

function PortraitMenu({
  groupedItems,
  menuOrder,
  sets,
  onSetDrop,
  equippedIds,
  equippedTypes,
  itemRows,
  itemTile,
  onItemDrop,
  onItemRemove,
  dolls,
  currentDollId,
  onDollChange,
  dropTargetId,
  backgrounds,
  currentBackgroundId,
  onBackgroundChange,
  onDragMove,
  onDragEnd,
  onBackgroundDragMove,
  onBackgroundDragEnd,
}: PortraitMenuProps) {
  const categories = Array.from(groupedItems.keys());
  const [chosen, setChosen] = useState<string | null>(null);
  // 選んだカテゴリが無くなったら（ドールを替えたとき）、先頭のカテゴリに戻す
  const selected =
    chosen === PORTRAIT_BACKGROUND && backgrounds.length > 0
      ? PORTRAIT_BACKGROUND
      : chosen === SET_CATEGORY && sets.length > 0
        ? SET_CATEGORY
        : chosen !== null && chosen !== SET_CATEGORY && groupedItems.has(chosen)
          ? chosen
          : (categories[0] ?? (backgrounds.length > 0 ? PORTRAIT_BACKGROUND : null));
  const items = selected && selected !== PORTRAIT_BACKGROUND && selected !== SET_CATEGORY ? (groupedItems.get(selected) ?? []) : [];
  const isSetWorn = (set: MenuSet) => set.items.every((i) => equippedIds.has(i.id));
  // 服は、上から下へ段を埋めてから右へ進む（横に流す）
  // 絵の大きさと段の数は、配置の計算（layout.ts）が決める
  const grid: CSSProperties = { gridTemplateRows: `repeat(${Math.max(1, itemRows)}, ${itemTile}px)`, gridAutoColumns: `${itemTile}px` };

  return (
    <div className="portrait-menu" data-menu="dressup-menu">
      <div className="portrait-categories" data-testid="portrait-categories">
        <select className="portrait-doll-select" value={currentDollId} onChange={(e) => onDollChange(e.target.value)} disabled={dolls.length === 0} aria-label="ドール">
          {dolls.length === 0 ? (
            <option value="">ドールなし</option>
          ) : (
            dolls.map((doll) => (
              <option key={doll.id} value={doll.id}>
                {doll.name}
              </option>
            ))
          )}
        </select>
        {backgrounds.length > 0 && (
          <button
            type="button"
            className={`portrait-category${currentBackgroundId ? ' worn' : ''}`}
            aria-pressed={selected === PORTRAIT_BACKGROUND}
            onClick={() => setChosen(PORTRAIT_BACKGROUND)}
          >
            <span className="portrait-category-thumb" aria-hidden="true">🖼️</span>
            <span className="portrait-category-label">はいけい</span>
          </button>
        )}
        {menuOrder.map((category) => {
          if (category === SET_CATEGORY) return (
          <button
            key={SET_CATEGORY}
            type="button"
            className={`portrait-category${sets.some(isSetWorn) ? ' worn' : ''}`}
            aria-pressed={selected === SET_CATEGORY}
            onClick={() => setChosen(SET_CATEGORY)}
          >
            <span className="portrait-category-thumb">
              {sets[0].items[0] && <img src={sets[0].items[0].thumbnailUrl || sets[0].items[0].imageUrl} alt="" draggable={false} loading="lazy" />}
            </span>
            <span className="portrait-category-label">{SET_LABEL}</span>
          </button>
          );
          const first = groupedItems.get(category)?.[0];
          return (
            <button
              key={category}
              type="button"
              className={`portrait-category${equippedTypes.has(category) ? ' worn' : ''}`}
              aria-pressed={selected === category}
              onClick={() => setChosen(category)}
            >
              <span className="portrait-category-thumb">
                {first && <img src={first.thumbnailUrl || first.imageUrl} alt="" draggable={false} loading="lazy" />}
              </span>
              <span className="portrait-category-label">{category}</span>
            </button>
          );
        })}
        {categories.length === 0 && <p className="portrait-empty">まだ ふくが ありません</p>}
      </div>
      <div className="portrait-items" data-testid="portrait-items" style={grid}>
        {selected === PORTRAIT_BACKGROUND ? (
          <>
            {currentBackgroundId !== null && (
              <button type="button" className="portrait-none" style={{ width: itemTile, height: itemTile }} onClick={() => onBackgroundChange?.(null)}>
                ✕ なし
              </button>
            )}
            {backgrounds.map((bg) => (
              <DraggableBackground
                key={bg.id}
                bg={bg}
                isSelected={currentBackgroundId === bg.id}
                onDrop={onBackgroundChange ?? (() => {})}
                dropTargetId={dropTargetId}
                onDragMove={onBackgroundDragMove}
                onDragEnd={onBackgroundDragEnd}
                size={itemTile}
                scrollRow
              />
            ))}
          </>
        ) : selected === SET_CATEGORY ? (
          sets.map((set) => (
            <DraggableSet key={set.id} set={set} isWorn={isSetWorn(set)} onDrop={onSetDrop} onRemove={onItemRemove} dropTargetId={dropTargetId} onDragMove={onDragMove} onDragEnd={onDragEnd} size={itemTile} scrollRow />
          ))
        ) : (
          items.map((item) => (
            <DraggableItem
              key={item.id}
              item={item}
              isEquipped={equippedIds.has(item.id)}
              onDrop={onItemDrop}
              onRemove={onItemRemove}
              dropTargetId={dropTargetId}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              size={itemTile}
              scrollRow
            />
          ))
        )}
      </div>
    </div>
  );
}

interface DraggableItemProps {
  item: ClothingItemData;
  isEquipped: boolean;
  onDrop: (item: ClothingItemData) => void;
  onRemove?: (items: ClothingItemData[]) => void; // 着ているときにタップすると脱がせる
  dropTargetId: string;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
  size?: number; // 縦画面の大きさ（無ければ、横のメニューの大きさ）
  // 縦画面の、横に流す行の中にある: 指ではっきり横になぞったときは、着せずに行を流す
  scrollRow?: boolean;
}

// 縦画面の行の中で、指の動き始めを「着せるドラッグ」か「行を流す」かに振り分ける。
// 行が画面に収まっていれば、いつでもドラッグ。収まっていないときだけ、はっきり横（横の動きが縦の 1.5 倍より大きい）なら流す。
// ブラウザ任せ（touch-action: pan-x）にすると、斜めに動かしただけで「流す」と判断されて、着せられないことがある
const GESTURE_START_PX = 10;
type RowGesture = { mode: 'pending' | 'drag' | 'scroll'; scroller: HTMLElement | null; startScroll: number };
function startRowGesture(e: React.PointerEvent, scrollRow: boolean): RowGesture {
  const scroller = scrollRow ? (e.currentTarget as HTMLElement).closest<HTMLElement>('.portrait-items') : null;
  const canScroll = !!scroller && e.pointerType !== 'mouse' && scroller.scrollWidth > scroller.clientWidth + 1;
  return { mode: canScroll ? 'pending' : 'drag', scroller, startScroll: scroller?.scrollLeft ?? 0 };
}
// 動いた量から、振り分けを進める。まだ決まらない・行を流した、なら true を返す（呼んだ側は、ドラッグとして扱わない）
function advanceRowGesture(g: RowGesture, dx: number, dy: number): boolean {
  if (g.mode === 'pending') {
    if (Math.hypot(dx, dy) < GESTURE_START_PX) return true;
    g.mode = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'scroll' : 'drag';
  }
  if (g.mode !== 'scroll') return false;
  if (g.scroller) g.scroller.scrollLeft = g.startScroll - dx;
  return true;
}

const pointInside = (selector: string, x: number, y: number): boolean => {
  const element = document.querySelector(selector);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

// メニューのタイル（服・背景・セット）をつかんで、ドールへ運ぶ操作。
// 離した場所がメニューの上なら何もしない。キャンバス（dropTargetId）の上なら onDrop。
// tapApplies: ほとんど動かさずに離したとき（タップ）も onDrop するか（背景だけ）
function useTileDrag(options: {
  scrollRow: boolean;
  dropTargetId: string;
  menuSelector: string;
  tapApplies: boolean;
  onDrop: () => void;
  onTap?: () => void; // タップ（ほぼ移動なし）したとき（tapApplies でないとき）

  onMove?: (position: Position) => void;
  onEnd?: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const movedDistance = useRef(0);
  const gesture = useRef<RowGesture>({ mode: 'drag', scroller: null, startScroll: 0 });
  const stop = () => {
    setIsDragging(false);
    setDragPos({ x: 0, y: 0 });
    options.onEnd?.();
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPos.current = { x: e.clientX, y: e.clientY };
      setDragPos({ x: 0, y: 0 });
      movedDistance.current = 0;
      gesture.current = startRowGesture(e, options.scrollRow);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (advanceRowGesture(gesture.current, dx, dy)) return;
      movedDistance.current = Math.max(movedDistance.current, Math.hypot(dx, dy));
      setDragPos({ x: dx, y: dy });
      options.onMove?.({ x: e.clientX, y: e.clientY });
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!isDragging) return;
      stop();
      // 行を流しただけなら、何もしない
      if (gesture.current.mode === 'scroll') return;
      // タップ（ほぼ移動なし）
      if (movedDistance.current < 10) {
        if (options.tapApplies) options.onDrop();
        else options.onTap?.();
        return;
      }
      // メニュー領域上で指を離した場合は何もしない（キャンバスが背面にあっても誤判定を防ぐ）
      if (pointInside(options.menuSelector, e.clientX, e.clientY)) return;
      if (pointInside(`[data-testid="${options.dropTargetId}"]`, e.clientX, e.clientY)) options.onDrop();
    },
    onPointerCancel: stop,
  };
  // タイルの見た目（つかんでいる間は指に付いていく）
  const dragStyle = (size?: number): CSSProperties => ({
    ...(isDragging ? styles.itemDragging : {}),
    transform: isDragging ? `translate(${dragPos.x}px, ${dragPos.y}px)` : 'none',
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
    ...(size ? { width: `${size}px`, height: `${size}px`, flex: 'none' } : {}),
  });
  return { handlers, dragStyle };
}

const BROKEN_ITEM = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">?</text></svg>';
const BROKEN_BACKGROUND = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="20">🖼️</text></svg>';

const DraggableItem = memo(function DraggableItem({ item, isEquipped, onDrop, onRemove, dropTargetId, onDragMove, onDragEnd, size, scrollRow = false }: DraggableItemProps) {
  const drag = useTileDrag({
    scrollRow,
    dropTargetId,
    menuSelector: '.palette-section',
    tapApplies: false, // タップ（ほぼ移動なし）は装着しない。着ている服なら、脱がせる
    onDrop: () => onDrop(item),
    onTap: isEquipped && onRemove ? () => onRemove([item]) : undefined,
    onMove: onDragMove ? (position) => onDragMove(item, position) : undefined,
    onEnd: onDragEnd,
  });

  return (
    <div
      style={{ ...styles.itemButton, ...(isEquipped ? styles.itemButtonEquipped : {}), ...drag.dragStyle(size) }}
      data-draggable=""
      data-mine={item.mine ? 'true' : undefined}
      {...drag.handlers}
    >
      <div style={styles.itemImageContainer}>
        {/* 自分の服（この端末の利用者にだけ出る服）の印 */}
        {item.mine && <div style={styles.mineBadge}>★</div>}
        <img
          src={item.thumbnailUrl || item.imageUrl}
          alt={item.name}
          style={styles.itemImage}
          draggable={false}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = BROKEN_ITEM;
          }}
        />
        {isEquipped && (
          <div style={styles.equippedBadge}>✓</div>
        )}
      </div>
    </div>
  );
});

// セット（同じテーマで一度に作った服の集まり）のタイル。ドールへ運ぶと、パーツが全部着る。
// 絵は、パーツのサムネイルを 4 つまで並べたもの（専用の絵は持たないので、パーツを消しても古くならない）
const DraggableSet = memo(function DraggableSet({
  set,
  isWorn,
  onDrop,
  onRemove,
  dropTargetId,
  onDragMove,
  onDragEnd,
  size,
  scrollRow = false,
}: {
  set: MenuSet;
  isWorn: boolean; // パーツを全部着ている
  onDrop: (items: ClothingItemData[]) => void;
  onRemove?: (items: ClothingItemData[]) => void; // 全部着ているときにタップすると、パーツを全部脱がせる
  dropTargetId: string;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
  size?: number;
  scrollRow?: boolean;
}) {
  const drag = useTileDrag({
    scrollRow,
    dropTargetId,
    menuSelector: '.palette-section',
    tapApplies: false,
    onDrop: () => onDrop(set.items),
    onTap: isWorn && onRemove ? () => onRemove(set.items) : undefined,
    // 指に付いてくる絵は、先頭のパーツ
    onMove: onDragMove && set.items[0] ? (position) => onDragMove(set.items[0], position) : undefined,
    onEnd: onDragEnd,
  });
  const shown = set.items.slice(0, 4);

  return (
    <div
      style={{ ...styles.itemButton, ...(isWorn ? styles.itemButtonEquipped : {}), ...drag.dragStyle(size) }}
      data-draggable=""
      data-testid="set-tile"
      data-worn={isWorn ? 'true' : 'false'}
      title={set.name}
      {...drag.handlers}
    >
      <div style={styles.itemImageContainer}>
        <div style={shown.length > 1 ? styles.setMosaic : styles.setSingle}>
          {shown.map((item) => (
            <img key={item.id} src={item.thumbnailUrl || item.imageUrl} alt="" style={styles.setMosaicImage} draggable={false} loading="lazy" />
          ))}
        </div>
        <span style={styles.setLabel}>{set.name}</span>
        {isWorn && <div style={styles.equippedBadge}>✓</div>}
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
  size,
  scrollRow = false,
}: {
  bg: BackgroundData;
  isSelected: boolean;
  onDrop: (bgId: string | null) => void;
  dropTargetId: string;
  onDragMove?: (bg: BackgroundData, position: Position) => void;
  onDragEnd?: () => void;
  size?: number;
  scrollRow?: boolean;
}) {
  const drag = useTileDrag({
    scrollRow,
    dropTargetId,
    menuSelector: '[data-menu="dressup-menu"]',
    tapApplies: true, // 背景は、タップ（ほぼ移動なし）でも適用
    onDrop: () => onDrop(bg.id),
    onMove: onDragMove ? (position) => onDragMove(bg, position) : undefined,
    onEnd: onDragEnd,
  });

  return (
    <div
      style={{ ...styles.itemButton, ...(isSelected ? styles.itemButtonSelected : {}), ...drag.dragStyle(size) }}
      data-draggable=""
      {...drag.handlers}
    >
      <div style={styles.itemImageContainer}>
        <img
          src={bg.thumbnailUrl || bg.imageUrl}
          alt={bg.name}
          style={styles.itemImage}
          draggable={false}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = BROKEN_BACKGROUND;
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
  // セットのタイル: パーツのサムネイルを 2×2 に並べる。名前は下に重ねる
  setMosaic: {
    width: '100%',
    height: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: '1fr 1fr',
    gap: '2px',
    pointerEvents: 'none',
  },
  setSingle: {
    width: '100%',
    height: '100%',
    display: 'grid',
    pointerEvents: 'none',
  },
  setMosaicImage: {
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    objectFit: 'contain',
  },
  setLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: '1px 2px',
    fontSize: '10px',
    lineHeight: '12px',
    textAlign: 'center',
    color: '#555',
    background: 'rgba(255, 255, 255, 0.85)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    pointerEvents: 'none',
  },
  mineBadge: {
    position: 'absolute',
    top: '-2px',
    left: '-2px',
    fontSize: '11px',
    lineHeight: '12px',
    color: '#f5a623',
    pointerEvents: 'none',
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
