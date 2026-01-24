"""
画像一括最適化スクリプト
フォルダ構成・ファイル名を維持したまま画像サイズを縮小

使い方:
  python scripts/optimize-images.py [対象フォルダ]

例:
  python scripts/optimize-images.py preset-template
  python scripts/optimize-images.py preset-template/doll-きせかえにんぎょう/clothing
"""

import os
import sys
from pathlib import Path
from PIL import Image

# === 設定 ===
# 服・ドール画像の最大サイズ（長辺px）
MAX_CLOTHING_SIZE = 384
# 背景画像の最大サイズ
MAX_BACKGROUND_SIZE = 384
# サムネイル画像の最大サイズ
MAX_THUMBNAIL_SIZE = 128
# PNG圧縮レベル (0-9, 高いほど圧縮率高いが遅い)
PNG_COMPRESS_LEVEL = 9
# JPEG品質 (1-100)
JPEG_QUALITY = 80

def get_max_size(file_path: Path) -> int:
    """ファイルパスから適切な最大サイズを判定"""
    path_str = str(file_path).lower()
    file_name = file_path.name.lower()
    if 'サムネ' in file_path.name or '_thumb' in file_name:
        return MAX_THUMBNAIL_SIZE
    if 'background' in path_str:
        return MAX_BACKGROUND_SIZE
    return MAX_CLOTHING_SIZE

def optimize_image(file_path: Path, dry_run: bool = False) -> tuple[int, int]:
    """
    画像を最適化
    Returns: (元サイズ, 新サイズ) in bytes
    """
    original_size = file_path.stat().st_size
    max_size = get_max_size(file_path)
    
    try:
        with Image.open(file_path) as img:
            # 元のサイズ
            orig_width, orig_height = img.size
            
            # 透過情報を保持
            has_alpha = img.mode in ('RGBA', 'LA', 'PA')
            
            # リサイズが必要か判定
            if orig_width <= max_size and orig_height <= max_size:
                # サイズは問題ないが、PNG最適化は行う
                if file_path.suffix.lower() == '.png':
                    if dry_run:
                        return original_size, original_size
                    # 透過を維持してPNG最適化
                    if has_alpha:
                        img = img.convert('RGBA')
                    else:
                        img = img.convert('RGB')
                    img.save(file_path, 'PNG', optimize=True, compress_level=PNG_COMPRESS_LEVEL)
                    new_size = file_path.stat().st_size
                    return original_size, new_size
                return original_size, original_size
            
            # アスペクト比を維持してリサイズ
            ratio = min(max_size / orig_width, max_size / orig_height)
            new_width = int(orig_width * ratio)
            new_height = int(orig_height * ratio)
            
            if dry_run:
                # 予測サイズ（実際の圧縮率に依存するので概算）
                estimated_ratio = (new_width * new_height) / (orig_width * orig_height)
                return original_size, int(original_size * estimated_ratio * 0.8)
            
            # 高品質リサイズ
            resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # 保存
            suffix = file_path.suffix.lower()
            if suffix == '.png':
                if has_alpha:
                    resized = resized.convert('RGBA')
                else:
                    resized = resized.convert('RGB')
                resized.save(file_path, 'PNG', optimize=True, compress_level=PNG_COMPRESS_LEVEL)
            elif suffix in ('.jpg', '.jpeg'):
                resized = resized.convert('RGB')
                resized.save(file_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
            elif suffix == '.webp':
                resized.save(file_path, 'WEBP', quality=JPEG_QUALITY)
            else:
                # その他の形式はそのまま
                resized.save(file_path)
            
            new_size = file_path.stat().st_size
            return original_size, new_size
            
    except Exception as e:
        print(f"  エラー: {file_path.name} - {e}")
        return original_size, original_size

def main():
    # 対象フォルダ
    if len(sys.argv) > 1:
        target_dir = Path(sys.argv[1])
    else:
        # デフォルトはpreset-template
        script_dir = Path(__file__).parent
        target_dir = script_dir.parent / 'preset-template'
    
    if not target_dir.exists():
        print(f"エラー: フォルダが見つかりません: {target_dir}")
        sys.exit(1)
    
    print(f"対象フォルダ: {target_dir}")
    print(f"設定: 服/ドール={MAX_CLOTHING_SIZE}px, 背景={MAX_BACKGROUND_SIZE}px")
    print("-" * 50)
    
    # 画像ファイルを収集
    image_extensions = {'.png', '.jpg', '.jpeg', '.webp'}
    image_files = [
        f for f in target_dir.rglob('*')
        if f.suffix.lower() in image_extensions and f.is_file()
    ]
    
    if not image_files:
        print("画像ファイルが見つかりませんでした")
        sys.exit(0)
    
    print(f"対象ファイル数: {len(image_files)}")
    
    # 確認
    print("\n処理を開始しますか？ (y/n): ", end="")
    if input().strip().lower() != 'y':
        print("キャンセルしました")
        sys.exit(0)
    
    print("\n処理中...")
    
    total_original = 0
    total_new = 0
    processed = 0
    
    for i, file_path in enumerate(image_files, 1):
        rel_path = file_path.relative_to(target_dir)
        orig_size, new_size = optimize_image(file_path)
        total_original += orig_size
        total_new += new_size
        
        # 変化があった場合のみ表示
        if orig_size != new_size:
            reduction = (1 - new_size / orig_size) * 100
            print(f"  [{i}/{len(image_files)}] {rel_path.name}: {orig_size//1024}KB → {new_size//1024}KB (-{reduction:.0f}%)")
            processed += 1
        
        # 進捗表示（10ファイルごと）
        if i % 10 == 0:
            print(f"  進捗: {i}/{len(image_files)}")
    
    print("-" * 50)
    print(f"完了!")
    print(f"処理ファイル数: {processed}/{len(image_files)}")
    print(f"合計サイズ: {total_original/1024/1024:.1f}MB → {total_new/1024/1024:.1f}MB")
    print(f"削減量: {(total_original - total_new)/1024/1024:.1f}MB ({(1 - total_new/total_original) * 100:.0f}%減)")

if __name__ == '__main__':
    main()
