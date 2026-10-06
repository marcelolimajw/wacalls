# Integração com Chatwoot — widget de chamada (voz e vídeo)

Guia prático para embutir o botão de ligação do AstraCalls dentro de uma conversa do
Chatwoot — incluindo **como ligar em vídeo**.

> O Chatwoot **não participa da mídia**. Ele apenas hospeda um `<script>`; a chamada
> WebRTC é aberta direto do **navegador do agente** contra o AstraCalls, e o AstraCalls
> injeta o áudio/vídeo na malha do WhatsApp.

---

## 1. Pré-requisitos

| Requisito | Por quê |
|---|---|
| AstraCalls de pé e acessível por **HTTPS** | o Chatwoot roda em HTTPS; um `fetch` pra origem HTTP é bloqueado por *mixed content* |
| Sessão WhatsApp **pareada e conectada** | sem sessão não há caixa para ligar |
| Inbox do Chatwoot **vinculada** à sessão AstraCalls | o botão só aparece nesse caso (ver [§7](#7-por-que-o-botão-não-aparece)) |
| `WACALLS_API_KEY` definida | sem ela o middleware de auth nem é aplicado — qualquer um chama a API |
| Navegador do agente com **WebCodecs** | obrigatório só para vídeo (Chrome/Edge) |

---

## 2. Instalação

No Chatwoot: **super_admin → App Configuration (interno) → campo de scripts**, cole:

```html
<script src="https://SEU-ASTRACALLS/widget.js" data-api-key="SUA_CHAVE"></script>
```

O `widget.js` é servido pelo próprio AstraCalls (com `Cache-Control: no-cache`, então
atualizações do widget chegam sem purge de cache).

### Atributos

| Atributo | Obrigatório | Significado |
|---|---|---|
| `data-api-key` | sim* | chave enviada no header `X-API-Key`. \*Só se `WACALLS_API_KEY` estiver setada no servidor |
| `data-url` | não | origem da API. Padrão: a origem do próprio `<script>` |
| `data-anchor` | não | seletor CSS indicando onde injetar o botão. Padrão: ele procura sozinho a barra de ações da conversa |

Sem `data-anchor`, o widget localiza a barra de ações por geometria (botões quadrados
de ~32px no lado direito, pai com 2–6 botões) e, como fallback, pelo texto
**"Ações da conversa"**. Se o Chatwoot mudar o layout e o botão cair num lugar estranho,
use `data-anchor` para fixar.

---

## 3. ⚠️ Qual chave colocar no `data-api-key`

A chave fica **visível no DOM e na rede para todo agente logado** (issue #10). Use a
chave de widget, **nunca a mestra**.

### Opção A — chave estática por instância (`WACALLS_WIDGET_KEY`)

```bash
# no servidor AstraCalls
WACALLS_WIDGET_KEY=<valor>
```

Pede-se pela API (só com a chave-mestra):

```bash
curl -H "X-API-Key: $WACALLS_API_KEY" https://SEU-ASTRACALLS/api/widget-key
# {"widgetKey":"...","scope":"instance"}
```

Se `WACALLS_WIDGET_KEY` não estiver configurada, o endpoint responde **409**
`widget_key_not_configured` apontando para a opção B.

### Opção B — token efêmero por conta (recomendada)

```bash
curl -X POST https://SEU-ASTRACALLS/api/widget-tokens \
  -H "X-API-Key: $WACALLS_API_KEY" -H "Content-Type: application/json" \
  -d '{"accountId": 1, "inboxId": 2, "ttlSeconds": 3600}'
```

Formato `wt1.<payload>.<assinatura HMAC-SHA256>`; TTL padrão **1h**, máximo 24h.
A assinatura usa `WACALLS_WIDGET_SIGNING_SECRET` (se vazia, é derivada da
`WACALLS_API_KEY` — rotacionar a mestra invalida todos os tokens).

**Vantagem:** se vazar, o estrago fica limitado àquela conta/inbox e ao tempo de vida.
O SSE só entrega eventos da própria conta do token.

### O que cada credencial libera

| Credencial | Libera |
|---|---|
| **Mestra** (`WACALLS_API_KEY`) | tudo — sessões, mensagens, config, chamadas |
| **Widget** (`WACALLS_WIDGET_KEY` ou token `wt1…`) | só: `GET /api/events`, `GET /api/chatwoot/resolve` e `/api/sessions/{sid}/calls*` |

Ou quem tem a chave de widget **não** consegue listar/apagar sessões, mandar mensagens
nem mexer na configuração do Chatwoot.

---

## 4. Ligar em voz

1. Abra a conversa do contato — o ícone de telefone aparece na barra de ações do header.
2. Clique → painel flutuante mostra nome + número → botão **Ligar**.
3. Status **"Conectando…" → "Chamada…" → "Em chamada"**; o cronômetro só começa na
   conexão real.
4. **Encerrar** no botão vermelho.

Chamada **recebida**: o widget abre sozinho, toca e mostra **Atender / Recusar**.

---

## 5. Ligar em vídeo

O vídeo **já está no widget** — não é preciso script diferente. O botão de câmera fica
na fileira da **chamada ativa**:

```
[ 🔇 Mudo ] [ 📷 Câmera ] [ ☎ Encerrar ]
```

### Passo a passo

1. Faça a ligação de voz (§4) e espere conectar.
2. Clique no **ícone da câmera** ("Ativar vídeo").
3. O navegador pede acesso à câmera; o widget abre o canal de vídeo e chama
   `POST /api/sessions/{sid}/calls/{id}/video/request`.
4. O lado do WhatsApp recebe o pedido de upgrade. Quando o **outro lado** pedir vídeo,
   o widget **aceita automaticamente** (`video/accept`) — mas a câmera local só liga se
   **você** clicar no ícone.
5. Clique de novo para **desligar** (chama `video/stop`).

### Especificações do stream

| Parâmetro | Valor |
|---|---|
| Codec | H.264 (`avc1.42E01F`), Annex-B, WebCodecs |
| Resolução | 160 × 120 |
| FPS | 15 |
| Bitrate | 50 kbps |
| Keyframe | a cada 15 frames |
| Transporte | datachannel do WebRTC |

### Requisitos

- **WebCodecs** no navegador: `VideoEncoder`, `VideoDecoder`,
  `MediaStreamTrackProcessor`, `MediaStreamTrackGenerator` → **Chrome / Edge**.
  Sem isso o clique responde *"Vídeo não suportado neste navegador"*.
- Transporte **WebRTC**. Se `WACALLS_DEFAULT_TRANSPORT=websocket` o widget responde
  *"Vídeo indisponível (áudio via WebSocket)"* — o modo WebSocket é áudio-only.

### Alternativa: já ligar em vídeo pela API

```bash
curl -X POST https://SEU-ASTRACALLS/api/sessions/{sid}/calls \
  -H "X-API-Key: $CHAVE" -H "Content-Type: application/json" \
  -d '{"phone":"5511999999999","video":true,"duration_ms":300000,"record":false}'
```

> O `startCall` do widget **não** envia `video:true` — ele começa sempre em voz.
> Para ter um botão "Ligar em vídeo" separado no painel, é uma alteração pequena no
> `widget.js`.

### Negociação mid-call

`POST /api/sessions/{sid}/calls/{id}/video/{action}` — ações:
`request` · `accept` · `reject` · `stop`.
O estado é anunciado no SSE pelo evento `video-state`
(`{peerVideo, upgradeIncoming, upgradeOutgoing, state}`).

---

## 6. Como o widget decide aparecer

A cada troca de conversa o widget chama:

```
GET /api/chatwoot/resolve?account_id={acc}&conversation_id={conv}
```

- **200** → devolve `{session_id, phone, name}`; o botão é injetado.
- **erro** → o botão **não é injetado** (ou é removido).

O backend descobre o `inbox_id` da conversa e só responde 200 se houver uma **sessão
AstraCalls conectada amarrada àquela caixa**.

---

## 7. Por que o botão (não) aparece

| Sintoma | Causa | Solução |
|---|---|---|
| Sem ícone de telefone | inbox da conversa não tem sessão vinculada | vincule a inbox na configuração Chatwoot da sessão e confirme com o `resolve` |
| Sem ícone | sessão desconectada do WhatsApp | reconecte a sessão |
| Sem ícone | você não está numa conversa (`/conversations/{id}`) | abra uma conversa |
| Painel mostra *"Caixa sem WhatsApp"* | a conversa pertence a outra inbox | abra uma conversa da caixa conectada |
| Botão em posição errada | o Chatwoot mudou o layout | use `data-anchor` |
| **401 unauthorized** | chave errada/ausente no `data-api-key` | confira a chave (§3) |
| **409** `widget_key_not_configured` | `WACALLS_WIDGET_KEY` não está setada | use `POST /api/widget-tokens` |
| Widget não atualiza | cache agressivo | `widget.js` já sai com `no-cache`; force reload |
| Página em branco / nada carrega | mixed content | sirva o AstraCalls em **HTTPS** |
| *"Vídeo não suportado neste navegador"* | sem WebCodecs | use Chrome/Edge |
| *"Vídeo indisponível (áudio via WebSocket)"* | transporte WS | troque `WACALLS_DEFAULT_TRANSPORT` para WebRTC |

---

## 8. Variáveis de ambiente relevantes

| Env | Significado |
|---|---|
| `WACALLS_API_KEY` | chave-mestra. Se definida, exige `X-API-Key` (ou `?apiKey=`) em toda rota `/api/*` |
| `WACALLS_WIDGET_KEY` | chave estática de widget — a que vai no `data-api-key` |
| `WACALLS_WIDGET_SIGNING_SECRET` | segredo de assinatura dos tokens `wt1…` |
| `WACALLS_DEFAULT_TRANSPORT` | `websocket` força o modo WS (áudio-only, sem vídeo) |
| `WACALLS_PUBLIC_IP` | IP público p/ NAT 1:1 e ICE-TCP (`auto` detecta) |
| `WACALLS_UDP_PORT` | porta de mídia (UDP + ICE-TCP) |

> A rota `POST /api/sessions/{sid}/chatwoot/webhook` é **isenta** de API key — é ela
> que o próprio Chatwoot chama.

---

## 9. Referência de API

| Método | Rota | Observação |
|---|---|---|
| `GET` | `/widget.js` | o script (servido com `no-cache`) |
| `GET` | `/api/events` | SSE de chamadas (o widget passa `X-Client-Id`) |
| `GET` | `/api/chatwoot/resolve` | mapeia conversa do Chatwoot → sessão/telefone |
| `POST` | `/api/sessions/{sid}/calls` | inicia chamada — `{phone, video?, duration_ms?, record?}` |
| `POST` | `/api/sessions/{sid}/calls/{id}/accept` · `/reject` | atende/recusa |
| `POST` | `/api/sessions/{sid}/calls/{id}/webrtc` | troca SDP |
| `GET` | `/api/sessions/{sid}/calls/{id}/ws` | ponte WebSocket de áudio (full-duplex) |
| `POST` | `/api/sessions/{sid}/calls/{id}/video/{action}` | `request`/`accept`/`reject`/`stop` |
| `POST` | `/api/sessions/{sid}/calls/{id}/hold` · `/resume` · `/transfer` · `/pickup` | controle mid-call |
| `DELETE` | `/api/sessions/{sid}/calls/{id}` | encerra |
| `GET` | `/api/widget-key` | devolve a chave de widget (só mestra) |
| `POST` | `/api/widget-tokens` | emite token efêmero por conta (só mestra) |

---

## 10. Dicas

- **Gravação:** ligue com `PUT /api/sessions/{sid}/recording {"enabled":true}` — ao fim
  da chamada o MP3 vira **nota privada** na conversa do número no Chatwoot.
- **Multi-conta:** cada inbox pode ter sua própria sessão; o `resolve` é quem resolve
  qual usar. Tokens de widget escopados por conta evitam vazamento entre contas.
- **Recebidas:** uma chamada recebida abre o widget sozinho no navegador do agente —
  desde que ele esteja com o Chatwoot aberto e o SSE conectado.
