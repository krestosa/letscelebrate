# Snow

**Cargar solo `snow.css` y `snow.js`.**

```html
<link rel="stylesheet" href="snow.css">
<script src="snow.js" defer></script>

<div class="snow">Contenido</div>
```

Opcional: `data-snow-density="0.7"`, `data-snow-tilt="false"`.

## API opcional

- `SnowEffect.mount(el)`: activar.
- `SnowEffect.unmount(el)`: apagar.
- `SnowEffect.refresh()`: reevaluar contenedores.

Inclinación automática si los sensores ya están autorizados. Sin solicitudes de permiso. La nieve se superpone al contenido de `.snow` sin capturar clics.

`el` es el elemento HTML. `demo.html` es solo una prueba.
