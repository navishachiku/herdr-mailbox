# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#instalación">instalación</a> · <a href="#uso">uso</a> · <a href="#enviar-una-carta">enviar una carta</a> · <a href="#límites">límites</a> · <a href="./guide.md">guía completa</a>
</p>

> En un multi-agent workflow, tu atención y tus decisiones son lo que más importa.

Ejecutas un multi-agent workflow en Herdr: un agente leader con varios agentes worker, cada uno en lo suyo. Sus informes y mensajes inundan la conversación del leader. Vas a mitad de una frase y un informe se cuela y se envía junto con ella; la pregunta de decisión que acaban de hacerte desaparece un segundo después bajo el siguiente mensaje.

Este plugin existe para resolver justo eso: que tu atención no se interrumpa y quede reservada para las decisiones de calidad que solo tú puedes tomar.

No es una nueva versión de las preguntas con opciones de Claude Code (AskUserQuestion). Aprovecha lo que ofrece Herdr para reunir en un solo lugar los informes y las preguntas pendientes de agentes de distintos proveedores, combinarlos y coordinarlos; y como la conversación ya no se inunda, también ahorra el consumo que esas avalanchas costarían.

**Antes**

![Sin buzón: el informe de un worker se escribe dentro del prompt a medio redactar y se envía con él; luego cada informe y cada pregunta despiertan al leader y el chat se llena](./media/demo-before.gif)

Mailbox le da un buzón al leader. Además de mensajes normales, que son como postales, los workers pueden dejarte tarjetas de decisión y tarjetas de debate para que las respondas. Los mensajes normales entran en un solo lote, y solo cuando no estás escribiendo y el leader está libre; las tarjetas esperan en el buzón hasta que las respondas con el ratón.

**Después**

![Con buzón: los informes esperan en el buzón mientras escribes, llegan en un solo lote, y las preguntas se responden con el ratón y se devuelven todas de una vez](./media/demo.gif)

- **Tu cuadro de entrada sigue siendo tuyo** — no se escribe nada mientras tú escribes, y nada llega mientras el leader sigue respondiendo.
- **Los mensajes normales llegan juntos** — esperan hasta un minuto para entrar como un solo lote y despertar al leader una sola vez; **Enviar ya** se salta la espera.
- **Las preguntas, en un solo lugar** — las preguntas de decisión se convierten en tarjetas junto al leader; responde con el ratón y envía todas las respuestas de una vez.
- **Cualquier agente puede escribir** — quien envía solo ejecuta `mailbox send`, así que Claude Code, Codex, agy y cualquier agente que pueda ejecutar un comando de shell escriben en el mismo buzón.
- **Un acuse de recibo por cada envío** — cada envío devuelve al instante el id de la carta y su estado.
- **Sigue al leader** — mover el pane, reiniciar Herdr o limpiar la conversación mantiene el buzón con el mismo destinatario.

## Instalación

Requiere Herdr 0.9.3 o posterior y Node 18 o posterior.

```sh
# 1. Instala el plugin
herdr plugin install navishachiku/herdr-mailbox

# 2. Ejecuta su acción setup: el comando `mailbox`, los hooks de Claude Code y las reglas de permiso de Codex y agy
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Las integraciones de agentes propias de Herdr, una por cada agente que uses
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. La skill que enseña a los agentes a enviar cartas
npx skills add navishachiku/herdr-mailbox
```

Un agente sin sistema de skills puede leer las mismas instrucciones con `mailbox skill`; pega su salida en el archivo de instrucciones de ese agente.

La acción setup hace una copia de seguridad de cada archivo antes de modificarlo (`<file>.bak-<date>`), no añade nada dos veces si se vuelve a ejecutar y sigue funcionando después de `herdr plugin update`. `node <plugin dir>/src/setup.mjs uninstall` la revierte. Reinicia las sesiones de Claude Code que deban recibir correo.

Añade el atajo al `config.toml` de Herdr (`~/.config/herdr/config.toml`; en Windows `%APPDATA%\herdr\config.toml`) y recarga con `prefix+shift+r` (`prefix` es `ctrl+b` salvo que lo hayas cambiado):

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

Si la acción no funciona en tu máquina, [AGENT-SETUP.md](../AGENT-SETUP.md) tiene los mismos pasos para que los siga un coding agent.

## Uso

Abre el buzón en la ventana del leader: selecciona el pane del leader y pulsa `prefix+shift+m`. El buzón pertenece al agente del pane donde pulsas el atajo, así que púlsalo en el del leader, no en el de un worker. La pantalla del buzón se abre junto al leader; volver a pulsar el atajo desde la pantalla, o `q`, la cierra, y las cartas se conservan.

- **Mensajes** — los mensajes normales de los workers esperan aquí y entran al leader en un solo lote; **Enviar ya** los envía al momento.
- **Preguntas** — tarjetas de decisión y de debate. Haz clic en una opción o escribe una nota, y **Enviar** devuelve todas las respuestas en un solo lote. **Aceptar todas**, **Preguntar todas** y **Anular todas** actúan sobre muchas tarjetas a la vez.
- **Opciones** — ancho de la pantalla, modo de tarjeta, cuánto esperan los mensajes normales para combinarse y el idioma de la pantalla (13 idiomas).

Si la pantalla no está abierta, una nueva pregunta de decisión o de debate muestra una notificación de Herdr con la pregunta; con la pantalla abierta no se muestra ninguna. Los workers escriben al leader con `mailbox send`, que se explica a continuación.

**Reclamar un buzón**: cuando se sustituye la conversación del leader, el buzón se desconecta y sus cartas se conservan. Ejecuta en el pane del nuevo agente la línea `mailbox claim MB-xxxx` que aparece en la pantalla, y el buzón vuelve a conectarse.

## Enviar una carta

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` acepta un id de pane, un nombre de agente o un id de buzón. `--recommend` es opcional; una tarjeta sin él no muestra ninguna opción recomendada.

El material más largo viaja con la carta como archivo (`--attach <file>`, hasta 5 por carta); la tarjeta muestra un enlace y, al hacer clic, el archivo se abre con el programa predeterminado del sistema (una imagen en el visor de imágenes, un archivo de texto en su aplicación predeterminada). Las direcciones web de una pregunta se abren en el navegador predeterminado.

`--wait [--timeout <ms>]` hace que el envío solo vuelva cuando el leader haya recogido la carta y terminado su turno. Si deja de esperar, sale con 3 o 4; en ambos casos una carta a un buzón ya está en cola o entregada, así que no la vuelvas a enviar. Una carta a un pane sin buzón se firma y se escribe directamente en él una sola vez, al instante. Las preguntas de debate, cómo consultar, editar y retirar cartas, y cada botón de la pantalla están en la [guía completa](./guide.md).

## Límites

- Una pregunta admite hasta 200 caracteres y un mensaje normal hasta 500; el texto más largo va en un archivo con `--attach`.
- El agente dueño del buzón (el leader) tiene que ser Claude Code o agy, porque la entrega espera a que su cuadro de entrada esté vacío y solo se pueden leer esos dos cuadros de entrada; quien envía puede ser cualquier agente.

## Problemas conocidos

- **Codex: todavía no puede ser dueño de un buzón.** Codex 0.163 ejecuta sus conversaciones en un único servidor en segundo plano compartido, así que la integración de Codex de Herdr atribuye cada conversación al pane que inició ese servidor, y el propio pane de Codex nunca recibe un id de conversación al que vincular un buzón. Codex sí puede enviar cartas, y un mensaje normal enviado a un pane de Codex sin buzón se firma y se escribe directamente en él una sola vez. El id de pane de Codex en `HERDR_PANE_ID` puede ser incorrecto, así que un remitente Codex debe indicar su propio pane con `--from <pane id>`.
- **agy: la skill no se instala donde agy la lee.** La CLI `skills` no puede instalar en la carpeta desde la que agy carga las skills, así que `npx skills add` no llega a ella. Es una limitación de esa CLI; el buzón no la sortea.
- **agy: ve la skill pero no usa el buzón por su cuenta.** Si solo le dices «informa a agent-a», agy recurre a su herramienta de mensajería integrada en lugar de `mailbox send`. Nombra el comando en la petición («envíalo con `mailbox send`»).

<details>
<summary>Avanzado: cómo funciona, estado, pruebas</summary>

### Cómo funciona

Un pequeño daemon es dueño del archivo de estado y atiende una petición a la vez. La CLI habla con él por un socket local y lo arranca si no está en marcha. El estado vive en el directorio de estado de plugins de Herdr, fuera del directorio del código del plugin, con una versión de esquema, y se escribe en disco antes de devolver el acuse de recibo. Cada sesión de Herdr tiene su propio subdirectorio, daemon y buzones, así que la misma dirección de pane en dos sesiones nunca comparte cartas.

| Pieza | Función |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | El daemon y las reglas de las cartas: acuses de recibo, deduplicación, editar y retirar, límites. |
| `src/identity.mjs` | Vincular un buzón a un destinatario, el bucle de reconciliación, reclamaciones. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Agrupación en lotes, comprobación del cuadro de entrada, confirmación, texto del lote. |
| `src/screen/` | La pantalla del buzón, con los ajustes mostrados dentro de ella; los adjuntos y los enlaces van a los programas predeterminados del sistema. |
| `src/open.mjs`, `src/on-focus.mjs` | La acción `prefix+shift+m` y la reapertura de la pantalla tras reiniciar Herdr. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Los hooks de Claude Code. |

### Pruebas

```sh
npm test
```

Ejecuta la CLI y el daemon reales contra un binario `herdr` falso, en un directorio de estado desechable.

</details>

## Licencia

MIT
