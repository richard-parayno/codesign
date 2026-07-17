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
      package = pkgs.nodejs_22;
      pnpm.enable = true;
      pnpm.install.enable = true;
    };
  };

  packages = [
    pkgs.git
    pkgs.codex
  ];

  enterShell = ''
    export PATH="$PWD/node_modules/.bin:$PATH"
  '';
}
