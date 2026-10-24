# Gerenciador desktop (M11)

Aplicativo Windows/macOS que instala e atualiza os pacotes `.mlpack` nas estações dos editores.

## Como cada instalação é protegida (§7.3, §9)
1. Lê o manifest do pacote no servidor (com ETag).
2. Baixa o `.mlpack` com **retomada**: se a rede cair, continua de onde parou (HTTP Range).
3. Confere o **SHA-256** do arquivo inteiro com o valor publicado.
4. Confere a **assinatura Ed25519** do `manifest.json`. A chave do servidor é registrada no primeiro login, e qualquer troca posterior é recusada.
5. Inspeciona o ZIP **antes** de extrair. Recusa: caminhos com `..`, caminhos absolutos, links simbólicos, duplicatas, arquivos não declarados, tamanhos divergentes e total acima do limite (proteção contra zip bomb).
6. Extrai para uma pasta temporária, conferindo o SHA-256 de cada arquivo.
7. **Troca atômica**: a nova versão só aparece completa. Uma falha em qualquer etapa mantém a versão anterior intacta.
8. Mantém a versão anterior para **rollback**. "Remover" tira o pacote da lista, mas não apaga os arquivos, para não quebrar projetos.

Pacotes **revogados** pelo administrador (kill-switch) são marcados e deixam de ser usados pelo plugin.

## Onde ficam os arquivos
- Windows: `%APPDATA%\Megalume Motion Hub\Library`
- macOS: `~/Library/Application Support/Megalume Motion Hub/Library`

A pasta pode ser trocada em Configurações. Os pacotes são copiados e a pasta antiga é mantida.

## Ligação com o plugin do Premiere
No painel do Premiere, clique em **Conectar biblioteca** (rodapé) e escolha a pasta `Library`.
Isso é feito uma única vez. A partir daí, o plugin usa os pacotes instalados sem baixar de novo, inclusive offline.

## Gerar instaladores
- **Portátil (Windows, sem instalação)**: `pnpm --filter @motionhub/desktop dist --win zip`
- **Instaladores assinados**: workflow `.github/workflows/desktop-release.yml`, que roda em Windows e macOS reais.
  Requer certificado de assinatura de código (Windows) e conta Apple Developer (macOS, para notarização).
  Sem esses certificados o build funciona, mas o Windows mostra um alerta do SmartScreen e o macOS bloqueia a abertura.
