#!/usr/bin/env bash
# Presente apenas na distribuição do fork. O instalador oficial continua sendo
# install.sh; este arquivo fixa o canal e a origem sem criar outra entrevista.

mcp_distribution_defaults() {
  DESKCOMM_UPDATE_CHANNEL=custom-mcp
  DESKCOMM_UPDATE_REPOSITORY=lucascruzfl/DeskcommCRM
  DESKCOMM_IMAGE_REPOSITORY=ghcr.io/lucascruzfl/deskcommcrm
  REPO_URL=https://github.com/lucascruzfl/DeskcommCRM.git
}

mcp_distribution_after_env() {
  # Uma pasta com .env oficial pode ser uma instalação em uso. Não a converta
  # silenciosamente ao executar o instalador a partir deste checkout.
  if [ -f .env ] && [ "${DESKCOMM_UPDATE_CHANNEL:-}" != custom-mcp ]; then
    die "Esta pasta já tem .env de outro canal. Use uma pasta nova para instalar a distribuição MCP."
  fi
  if [ -f .env ] && { [ "${DESKCOMM_UPDATE_REPOSITORY:-}" != lucascruzfl/DeskcommCRM ] \
    || [ "${DESKCOMM_IMAGE_REPOSITORY:-}" != ghcr.io/lucascruzfl/deskcommcrm ]; }; then
    die "O .env desta pasta aponta para outra distribuição MCP. Instalação interrompida."
  fi
  mcp_distribution_defaults
}
