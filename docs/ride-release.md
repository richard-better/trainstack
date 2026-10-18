# Releasing Ride

[`Ride release`](../.github/workflows/ride-release.yml) archives Ride for iOS (with the watch app
inside) and macOS, signs it, and uploads both to App Store Connect. They appear in TestFlight once
Apple has processed them, which takes a few minutes. It also publishes the Mac app for Homebrew,
as below.

Ride is on Richard's Homebrew tap in two channels:

```sh
brew install --cask richard-better/tap/trainstack-ride        # named releases
brew install --cask richard-better/tap/trainstack-ride@alpha  # every push to main
```

Both come from [`Ride Homebrew`](../.github/workflows/ride-homebrew.yml), which builds the Mac app
with Developer ID through `apps/ride/scripts/build-notarized.sh`, notarizes and staples it, and
publishes `Ride-<version>.zip` and `SHA256SUMS` as the GitHub release `ride-v<version>`. It then
starts the tap's update workflow, which checks the checksum and moves the cask on. Named releases
are marked latest. [`Ride alpha`](../.github/workflows/ride-alpha.yml) publishes every push to
`main` that touches Ride as the prerelease `<marketing>-alpha.<build>`, and keeps the ten newest.
Developer ID builds cannot hold Sign in with Apple, so they sign in through Apple's web flow; see
[Sign in with Apple on the web](deployment.md#sign-in-with-apple-on-the-web).

Signing is cloud managed: the workflow gives `xcodebuild` an App Store Connect API key and lets
it create the distribution certificate and provisioning profiles, so no certificates or profiles
are stored in GitHub. The build number is the UTC time of the run (`yyMMddHHmm`), so it only ever
goes up.

## One-time setup

1. In [App Store Connect](https://appstoreconnect.apple.com/apps), create the app record for the
   bundle ID `com.trainstackhq.ride` on iOS and add macOS to it. The watch app
   (`com.trainstackhq.ride.watchkitapp`) ships inside the iOS app and needs no record of its own.
2. In Users and Access, open Integrations, then App Store Connect API, and create a team key with
   the Admin role. Cloud signing with Developer ID needs it: with App Manager, the run fails with
   `Cloud signing permission error`. Download the `.p8` file, which Apple lets you do once, and note the key ID and
   the issuer ID.
3. In the repository settings, create an environment named `testflight` and add three secrets:

   | Secret              | Value                                        |
   | ------------------- | -------------------------------------------- |
   | `ASC_KEY_ID`        | The key ID                                   |
   | `ASC_ISSUER_ID`     | The issuer ID                                |
   | `ASC_KEY_P8_BASE64` | `base64 -i AuthKey_XXXXXXXXXX.p8` (one line) |

   Paste the values straight into GitHub. Never put them in chat, files or command arguments.

   Add a fourth, `HOMEBREW_TAP_TOKEN`: a fine-grained personal access token for
   `richard-better/homebrew-tap` only, with read and write access to Actions. It lets the
   workflows start the tap's update.

4. Restrict the environment to the `main` branch, and require a reviewer if more than one person
   can push there.

## Releasing

Run `Ride release` from the Actions tab on `main` with the marketing version, such as `1.0.1`:

```bash
gh workflow run ride-release.yml --repo richard-better/trainstack -f version=1.0.1
```

The release creates the tag `ride-v1.0.1` itself. Alphas need nothing: merging to `main` publishes
one.

Once a build shows up in TestFlight, answer the export compliance question (Ride uses only the
encryption built into iOS and macOS), add it to a group, and invite testers. Internal testers (up
to 100 people on the App Store Connect team) get it straight away. External testers need Apple's
beta review for the first build of each version.

## Known gaps

The workflows have not been run yet. Expect to fix small things on the first release, such as the
runner image, a missing capability on the app ID, or the role of the API key. Cloud-managed
Developer ID signing is the least proven part. If it fails, the fallback is to import the existing
Developer ID certificate as a `.p12`, as Switcheroo does, and let Xcode still make the profile.
