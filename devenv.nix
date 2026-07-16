{
  pkgs,
  lib,
  config,
  ...
}:
{
  languages = {
    javascript = {
      enable = true;
      pnpm.enable = true;
      pnpm.install.enable = true;
    };
  };
}

