# Environment for Android builds (Git Bash):  source scripts/android-env.sh
export JAVA_HOME="$(ls -d "/c/Program Files/Microsoft/jdk-17"* 2>/dev/null | head -1)"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
export PATH="$JAVA_HOME/bin:$HOME/.cargo/bin:$ANDROID_HOME/platform-tools:$PATH"
