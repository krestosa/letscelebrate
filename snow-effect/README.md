# Snow

```html
<link rel="stylesheet" href="snow-effect/snow.css">
<script src="snow-effect/snow.js" defer></script>

<div class="snow">Contenido</div>
```

Opcional: `data-snow-density="0.7"`, `data-snow-tilt="false"`, `style="--snow-z-index: 5"`.

## API opcional

```js
const el = document.querySelector("#popup");
SnowEffect.mount(el);        // agrega la clase e inicia
SnowEffect.unmount(el);      // quita la clase y libera recursos
SnowEffect.refresh();        // reevalúa los contenedores
SnowEffect.requestMotion(el); // permiso de inclinación, desde un clic
```

La clase basta; no se necesita llamar a la API. Los sensores requieren navegador compatible y contexto seguro (HTTPS o localhost).

Demo: `demo.html`.
