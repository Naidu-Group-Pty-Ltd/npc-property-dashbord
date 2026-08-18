plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "au.com.npcservices.npc_command_centre"

    // API 36 from the first commit, not migrated to later.
    // Google Play requires new apps and updates to target Android 16
    // (API 36) from 31 August 2026 (mobile/plan.md R-GPL-1, ARCHITECTURE.md
    // A8). There is no window in which starting lower is cheaper.
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "au.com.npcservices.npc_command_centre"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // Android 8.0. Matches the floor declared in plan.md R-BOTH-7.
        minSdk = 26
        targetSdk = 36
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Three environments, matching NpcFlavor. A flavor selects which
    // tenant-discovery domain is consulted (ARCHITECTURE.md A6) — it never
    // compiles a backend in, because the platform provisions one clone per
    // tenant and a hardcoded URL would serve exactly one of them.
    flavorDimensions += "environment"
    productFlavors {
        create("development") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "NPC CC Dev")
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            resValue("string", "app_name", "NPC CC Staging")
        }
        create("production") {
            dimension = "environment"
            resValue("string", "app_name", "NPC Command Centre")
        }
    }

    buildTypes {
        release {
            // Release signing is supplied by CI (Play App Signing upload key).
            // Debug keys are kept only so `flutter run --release` works locally;
            // a release build without CI signing must never reach a store.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
