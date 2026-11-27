# Snow

```html
<link rel="stylesheet" href="snow-effect/snow.css">
<script src="snow-effect/snow.js" defer></script>

<div class="snow">Contenido</div>
```

Opcional: `data-snow-density="0.7"`, `data-snow-tilt="false"`, `style="--snow-z-index: 5"`.

## API opcional

| Método | Función |
| --- | --- |
| `SnowEffect.mount(el)` | Agrega la clase y activa la nieve. |
| `SnowEffect.unmount(el)` | Quita la clase y libera recursos. |
| `SnowEffect.refresh()` | Reevalúa los contenedores. |
| `SnowEffect.requestMotion(el)` | Solicita permiso de inclinación desde un clic. |

`el` es el elemento HTML. La clase basta para usar el efecto. Los sensores requieren un navegador compatible y contexto seguro.

Demo: `demo.html`.
