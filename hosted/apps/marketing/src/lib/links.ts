const unpublishedStoreListing = "#download";
const repository = "https://github.com/richard-better/trainstack";

export const links = {
  github: repository,
  docs: `${repository}/tree/main/docs`,
  rideAlphaGuide: `${repository}/blob/main/docs/ride-alpha.md`,
  rideMacDownload: `${repository}/releases/latest`,
  appStore: unpublishedStoreListing,
  macAppStore: unpublishedStoreListing,
};

export const brewInstall = {
  stable: "brew install --cask richard-better/tap/trainstack-ride",
  alpha: "brew install --cask richard-better/tap/trainstack-ride@alpha",
};
