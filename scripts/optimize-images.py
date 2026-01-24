"""
画像一括最適化スクリプト
フォルダ構成・ファイル名を維持したまま画像サイズを縮小

使い方:
  python scripts/optimize-images.py [対象フォルダ]              # 全画像を最適化
  python scripts/optimize-images.py --add [ファイルパス...]      # 指定画像を追加最適化
  python scripts/optimize-images.py --delete [ファイル名...]     # 指定画像を削除
  python scripts/optimize-images.py --list                      # 現在のアイテム一覧を表示

例:
  python scripts/optimize-images.py preset-template
  python scripts/optimize-images.py --add "preset-template/doll-test/clothing/新しい服.png"
  python scripts/optimize-images.py --delete "古い服.png" "不要な帽子.png"
  python scripts/optimize-images.py --list
"""

import os
import sys
import shutil
from pathlib import Path
from PIL import Image
import argparse

# === 設定 ===
# 服・ドール画像の最大サイズ（長辺px）
MAX_CLOTHING_SIZE = 1024
# 背景画像の最大サイズ（1024pxで十分高画質、2048pxはiPadでクラッシュの原因に）
MAX_BACKGROUND_SIZE = 1024
# サムネイル画像の最大サイズ
MAX_THUMBNAIL_SIZE = 256
# PNG圧縮レベル (0-9, 高いほど圧縮率高いが遅い)
PNG_COMPRESS_LEVEL = 9
# JPEG品質 (1-100)
JPEG_QUALITY = 85

# デフォルトのプリセットフォルダ
DEFAULT_PRESET_DIR = 'preset-template'
# 出力先（public/assets）
OUTPUT_DIR = 'public/assets'


def get_script_dir() -> Path:
    """スクリプトのディレクトリを取得"""
    return Path(__file__).parent


def get_project_root() -> Path:
    """プロジェクトルートを取得"""
    return get_script_dir().parent


def get_preset_dir() -> Path:
    """プリセットフォルダを取得"""
    return get_project_root() / DEFAULT_PRESET_DIR


def get_output_dir() -> Path:
    """出力フォルダを取得"""
    return get_project_root() / OUTPUT_DIR


def get_max_size(file_path: Path) -> int:
    """ファイルパスから適切な最大サイズを判定"""
    path_str = str(file_path).lower()
    file_name = file_path.name.lower()
    if 'サムネ' in file_path.name or '_thumb' in file_name:
        return MAX_THUMBNAIL_SIZE
    if 'background' in path_str:
        return MAX_BACKGROUND_SIZE
    return MAX_CLOTHING_SIZE


def optimize_image(file_path: Path, output_path: Path = None, dry_run: bool = False) -> tuple[int, int]:
    """
    画像を最適化
    output_path: 指定すると別の場所に出力（元ファイルは変更しない）
    Returns: (元サイズ, 新サイズ) in bytes
    """
    original_size = file_path.stat().st_size
    max_size = get_max_size(file_path)
    save_path = output_path if output_path else file_path
    
    try:
        with Image.open(file_path) as img:
            # 元のサイズ
            orig_width, orig_height = img.size
            
            # 透過情報を保持
            has_alpha = img.mode in ('RGBA', 'LA', 'PA')
            
            # リサイズが必要か判定
            needs_resize = orig_width > max_size or orig_height > max_size
            
            if not needs_resize:
                # サイズは問題ないが、PNG最適化は行う
                if file_path.suffix.lower() == '.png':
                    if dry_run:
                        return original_size, original_size
                    # 出力先ディレクトリを作成
                    save_path.parent.mkdir(parents=True, exist_ok=True)
                    # 透過を維持してPNG最適化
                    if has_alpha:
                        img = img.convert('RGBA')
                    else:
                        img = img.convert('RGB')
                    img.save(save_path, 'PNG', optimize=True, compress_level=PNG_COMPRESS_LEVEL)
                    new_size = save_path.stat().st_size
                    return original_size, new_size
                else:
                    # リサイズ不要でPNG以外の場合はコピー
                    if output_path and output_path != file_path:
                        save_path.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(file_path, save_path)
                    return original_size, original_size
            
            # アスペクト比を維持してリサイズ
            ratio = min(max_size / orig_width, max_size / orig_height)
            new_width = int(orig_width * ratio)
            new_height = int(orig_height * ratio)
            
            if dry_run:
                # 予測サイズ（実際の圧縮率に依存するので概算）
                estimated_ratio = (new_width * new_height) / (orig_width * orig_height)
                return original_size, int(original_size * estimated_ratio * 0.8)
            
            # 出力先ディレクトリを作成
            save_path.parent.mkdir(parents=True, exist_ok=True)
            
            # 高品質リサイズ
            resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # 保存
            suffix = file_path.suffix.lower()
            if suffix == '.png':
                if has_alpha:
                    resized = resized.convert('RGBA')
                else:
                    resized = resized.convert('RGB')
                resized.save(save_path, 'PNG', optimize=True, compress_level=PNG_COMPRESS_LEVEL)
            elif suffix in ('.jpg', '.jpeg'):
                resized = resized.convert('RGB')
                resized.save(save_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
            elif suffix == '.webp':
                resized.save(save_path, 'WEBP', quality=JPEG_QUALITY)
            else:
                # その他の形式はそのまま
                resized.save(save_path)
            
            new_size = save_path.stat().st_size
            return original_size, new_size
            
    except Exception as e:
        print(f"  エラー: {file_path.name} - {e}")
        return original_size, original_size


def list_items():
    """現在のプリセットアイテム一覧を表示"""
    preset_dir = get_preset_dir()
    output_dir = get_output_dir()
    
    if not preset_dir.exists():
        print(f"プリセットフォルダが見つかりません: {preset_dir}")
        return
    
    print(f"\n=== プリセットアイテム一覧 ===")
    print(f"ソース: {preset_dir}")
    print(f"出力先: {output_dir}")
    print("-" * 60)
    
    image_extensions = {'.png', '.jpg', '.jpeg', '.webp'}
    
    # カテゴリごとに整理
    categories = {}
    for f in preset_dir.rglob('*'):
        if f.suffix.lower() in image_extensions and f.is_file():
            # カテゴリを判定（親フォルダ名）
            rel_path = f.relative_to(preset_dir)
            parts = rel_path.parts
            if len(parts) >= 2:
                category = parts[-2]  # 親フォルダ
            else:
                category = 'root'
            
            if category not in categories:
                categories[category] = []
            categories[category].append(f)
    
    total_count = 0
    for category, files in sorted(categories.items()):
        print(f"\n【{category}】 ({len(files)}件)")
        for f in sorted(files, key=lambda x: x.name):
            size_kb = f.stat().st_size / 1024
            # 出力先に存在するかチェック
            rel_path = f.relative_to(preset_dir)
            output_path = output_dir / rel_path
            status = "✓" if output_path.exists() else "✗"
            print(f"  {status} {f.name} ({size_kb:.0f}KB)")
            total_count += 1
    
    print("-" * 60)
    print(f"合計: {total_count}件")


def add_items(file_paths: list[str]):
    """指定したファイルを追加（最適化してoutputへコピー）"""
    output_dir = get_output_dir()
    preset_dir = get_preset_dir()
    
    print(f"\n=== アイテム追加 ===")
    
    added = 0
    for file_path_str in file_paths:
        file_path = Path(file_path_str)
        
        if not file_path.exists():
            print(f"  ✗ ファイルが見つかりません: {file_path}")
            continue
        
        # プリセットフォルダからの相対パスを計算
        try:
            rel_path = file_path.relative_to(preset_dir)
        except ValueError:
            # preset-template外のファイルの場合
            print(f"  ✗ プリセットフォルダ外のファイルです: {file_path}")
            continue
        
        output_path = output_dir / rel_path
        
        print(f"  処理中: {rel_path}")
        orig_size, new_size = optimize_image(file_path, output_path)
        
        if output_path.exists():
            reduction = (1 - new_size / orig_size) * 100 if orig_size > 0 else 0
            print(f"    ✓ 追加完了: {orig_size//1024}KB → {new_size//1024}KB ({reduction:.0f}%削減)")
            added += 1
        else:
            print(f"    ✗ 追加失敗")
    
    print(f"\n追加完了: {added}/{len(file_paths)}件")


def delete_items(file_names: list[str]):
    """指定したファイル名のアイテムを削除（output側から）"""
    output_dir = get_output_dir()
    
    print(f"\n=== アイテム削除 ===")
    print(f"対象フォルダ: {output_dir}")
    
    if not output_dir.exists():
        print("出力フォルダが存在しません")
        return
    
    # 対象ファイルを検索
    image_extensions = {'.png', '.jpg', '.jpeg', '.webp'}
    targets = []
    
    for file_name in file_names:
        found = list(output_dir.rglob(file_name))
        if not found:
            # 拡張子なしで検索
            for ext in image_extensions:
                found.extend(output_dir.rglob(f"{file_name}{ext}"))
                found.extend(output_dir.rglob(f"{file_name}.*"))
        
        if found:
            targets.extend(found)
        else:
            print(f"  ✗ 見つかりません: {file_name}")
    
    if not targets:
        print("削除対象がありません")
        return
    
    # 重複を除去
    targets = list(set(targets))
    
    print(f"\n削除対象 ({len(targets)}件):")
    for t in targets:
        rel_path = t.relative_to(output_dir)
        print(f"  - {rel_path}")
    
    print("\n削除を実行しますか？ (y/n): ", end="")
    if input().strip().lower() != 'y':
        print("キャンセルしました")
        return
    
    deleted = 0
    for target in targets:
        try:
            target.unlink()
            print(f"  ✓ 削除: {target.name}")
            deleted += 1
        except Exception as e:
            print(f"  ✗ 削除失敗: {target.name} - {e}")
    
    print(f"\n削除完了: {deleted}/{len(targets)}件")


def optimize_all(target_dir: Path):
    """全画像を最適化"""
    if not target_dir.exists():
        print(f"エラー: フォルダが見つかりません: {target_dir}")
        sys.exit(1)
    
    print(f"対象フォルダ: {target_dir}")
    print(f"設定: 服/ドール={MAX_CLOTHING_SIZE}px, 背景={MAX_BACKGROUND_SIZE}px, サムネ={MAX_THUMBNAIL_SIZE}px")
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
    if total_original > 0:
        print(f"削減量: {(total_original - total_new)/1024/1024:.1f}MB ({(1 - total_new/total_original) * 100:.0f}%減)")


def main():
    parser = argparse.ArgumentParser(
        description='画像一括最適化スクリプト',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  python scripts/optimize-images.py preset-template         # 全画像を最適化
  python scripts/optimize-images.py --list                  # アイテム一覧表示
  python scripts/optimize-images.py --add "preset-template/doll-test/clothing/新しい服.png"
  python scripts/optimize-images.py --delete "古い服.png"
        """
    )
    
    parser.add_argument('target', nargs='?', help='最適化対象フォルダ')
    parser.add_argument('--list', '-l', action='store_true', help='現在のアイテム一覧を表示')
    parser.add_argument('--add', '-a', nargs='+', metavar='FILE', help='指定したファイルを追加（最適化してoutputへ）')
    parser.add_argument('--delete', '-d', nargs='+', metavar='NAME', help='指定したファイル名のアイテムを削除')
    
    args = parser.parse_args()
    
    # コマンド実行
    if args.list:
        list_items()
    elif args.add:
        add_items(args.add)
    elif args.delete:
        delete_items(args.delete)
    elif args.target:
        optimize_all(Path(args.target))
    else:
        # デフォルト: preset-templateを最適化
        optimize_all(get_preset_dir())


if __name__ == '__main__':
    main()
