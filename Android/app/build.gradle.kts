plugins {
    id("com.android.application")
}

android {
    namespace = "app.vera.multi"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "app.vera.multi"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "1.0.2"
        // Адрес сервера; переопределяется: gradlew assembleRelease -PveraServerUrl=https://...
        // localhost:3000 на телефоне работает через USB: adb reverse tcp:3000 tcp:3000
        val serverUrl = (project.findProperty("veraServerUrl") as String?) ?: "http://localhost:3000"
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Установка вручную (sideload): подписываем debug-ключом. Для Google Play
            // нужен собственный keystore — см. Android/README.md.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}
