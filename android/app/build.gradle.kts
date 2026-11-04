import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing: android/keystore.properties (not in git) names the key.
val keyProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// The app shows the built website (../dist, from `npm run build`), bundled
// as assets/www so it works offline from the first start.
val webAssets = layout.buildDirectory.dir("generated/web")
val syncWeb by tasks.registering(Sync::class) {
    from(rootProject.file("../dist")) {
        exclude("sw.js", "manifest.webmanifest", "videos/**") // browser-only
    }
    into(webAssets.map { it.dir("www") })
    doFirst {
        if (!rootProject.file("../dist/index.html").exists())
            throw GradleException("Build the website first: npm run build:wasm && npm run build")
    }
}

android {
    namespace = "io.github.zetaone.xppautweb"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.zetaone.xppautweb"
        minSdk = 29 // Android 10: saving to Downloads without storage permission
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        if (keyProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    sourceSets["main"].assets.srcDir(webAssets)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild") { dependsOn(syncWeb) }
