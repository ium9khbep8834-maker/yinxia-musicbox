#!/usr/bin/env bash
# 一键构建「音匣」Android 壳（离线，使用本机 Gradle 缓存与本地 Android SDK）。
#
# 用法：
#   tools/build_android.sh            # 构建 debug APK 并复制到 dist/android/
#   tools/build_android.sh --clean    # 先清 build 目录再构建
#
# 环境（都已在脚本内固定为实测可用的本机路径，可用同名环境变量覆盖）：
#   JAVA_HOME        JDK 17
#   ANDROID_HOME     Android SDK（platforms/android-34 + build-tools/34.0.0）
#   GRADLE_USER_HOME Gradle 缓存（离线，已含 AGP 8.5.2）
#
# Windows 中文路径：AGP 会拒绝含非 ASCII 字符的工程路径（"Your project path contains
# non-ASCII characters"）。脚本检测到路径非 ASCII 时，自动用 `subst` 把仓库根与 SDK
# 映射到空闲盘符（默认从 Q 往后找），构建完成/失败后自动解除映射。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
DIST_DIR="$REPO_ROOT/dist/android"
APP_NAME="yinxia"
VERSION="1.0.0"

JAVA_HOME="D:/小说项目/tools/jdk17"
ANDROID_HOME="D:/小说项目/android-sdk"
GRADLE_USER_HOME="D:/小说项目/gradle-home"
GRADLE_BIN="${GRADLE_BIN:-D:/小说项目/tools/gradle-8.7/bin/gradle}"
export JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME" GRADLE_USER_HOME

CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "错误: $*" >&2; exit 1; }

[ -x "$JAVA_HOME/bin/java" ] || [ -x "$JAVA_HOME/bin/java.exe" ] || die "JAVA_HOME 无效: $JAVA_HOME"
[ -d "$ANDROID_HOME/platforms/android-34" ] || die "ANDROID_HOME 缺少 platforms/android-34: $ANDROID_HOME"
[ -x "$GRADLE_BIN" ] || die "Gradle 启动脚本不存在: $GRADLE_BIN"
[ -d "$REPO_ROOT/web" ] || die "前端目录不存在: $REPO_ROOT/web"

is_non_ascii() {
  # 含 ASCII 可见字符/空格以外的字节即视为非 ASCII（中文路径）
  printf '%s' "$1" | LC_ALL=C grep -q '[^ -~]'
}

MAPPED_DRIVES=()
cleanup() {
  local d
  for d in "${MAPPED_DRIVES[@]:-}"; do
    # 注意：git-bash 会把 /D 当路径改写，必须临时关闭 MSYS 参数转换
    [ -n "$d" ] && MSYS2_ARG_CONV_EXCL='*' subst "$d:" /D >/dev/null 2>&1 || true
  done
  MAPPED_DRIVES=()
}
trap cleanup EXIT INT TERM

MAP_RESULT=""
map_drive() {
  local path="$1" letter
  # 逐个字母试 subst：已被占用（真实盘/已有映射）的字母会失败，直接跳过
  for letter in Q R S T U V W Z; do
    if subst "$letter:" "$path" >/dev/null 2>&1; then
      MAPPED_DRIVES+=("$letter")
      MAP_RESULT="$letter"
      return 0
    fi
  done
  die "找不到可用盘符做 subst 映射: $path"
}

BUILD_DIR="$ANDROID_DIR"
SDK_FOR_BUILD="$ANDROID_HOME"
if is_non_ascii "$REPO_ROOT" || is_non_ascii "$ANDROID_HOME"; then
  echo "== 检测到非 ASCII 路径，使用 subst 映射盘符规避 AGP 限制"
  if is_non_ascii "$REPO_ROOT"; then
    map_drive "$REPO_ROOT"
    BUILD_DIR="$MAP_RESULT:/android"
    echo "   仓库: $REPO_ROOT  ->  $MAP_RESULT:/"
  fi
  if is_non_ascii "$ANDROID_HOME"; then
    map_drive "$ANDROID_HOME"
    SDK_FOR_BUILD="$MAP_RESULT:/"
    echo "   SDK:  $ANDROID_HOME  ->  $MAP_RESULT:/"
  fi
fi

# local.properties 由构建脚本生成（不依赖手工维护；sdk.dir 使用本次实际可用的路径）
printf 'sdk.dir=%s\n' "$(printf '%s' "$SDK_FOR_BUILD" | sed 's|\\|/|g')" > "$ANDROID_DIR/local.properties"

echo "== JAVA_HOME        = $JAVA_HOME"
echo "== ANDROID_HOME     = $ANDROID_HOME"
echo "== GRADLE_USER_HOME = $GRADLE_USER_HOME"
echo "== 构建目录         = $BUILD_DIR"
"$JAVA_HOME/bin/java" -version 2>&1 | sed 's/^/   /'

GRADLE_ARGS=(--offline --no-daemon --project-dir "$BUILD_DIR" --console=plain)
[ "$CLEAN" = "1" ] && GRADLE_ARGS+=(clean)

echo "== gradle assembleDebug（离线）"
set +e
"$GRADLE_BIN" "${GRADLE_ARGS[@]}" assembleDebug
RC=$?
set -e
[ "$RC" -eq 0 ] || die "Gradle 构建失败（退出码 $RC）"

SRC_APK="$BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$SRC_APK" ] || die "未找到 APK: $SRC_APK"

mkdir -p "$DIST_DIR"
DST_APK="$DIST_DIR/${APP_NAME}-${VERSION}-debug.apk"
cp -f "$SRC_APK" "$DST_APK"

SIZE="$(wc -c < "$DST_APK" | tr -d ' ')"
echo "== 构建成功"
echo "   APK: $DST_APK"
echo "   大小: $SIZE 字节 ($(awk "BEGIN{printf \"%.2f\", $SIZE/1048576}") MiB)"
echo "   SHA256: $(sha256sum "$DST_APK" | cut -d' ' -f1)"
