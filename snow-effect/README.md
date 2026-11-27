# Snow Effect — Canvas independiente

Efecto original de Let's Celebrate adaptado a contenedores HTML. No requiere framework, imágenes, fuentes ni dependencias externas. La landing original no se modifica.

## Integración

Copiar `snow.js` y `snow.css` a tu proyecto. Agregar una sola vez:

```html
<link rel="stylesheet" href="snow-effect/snow.css">
<script src="snow-effect/snow.js" defer></script>
```

Agregar la clase al contenedor del popup:

```html
<div class="snow">
  <!-- Contenido existente -->
</div>
```

El elemento debe tener una caja con ancho y alto (puede ser cualquier contenedor, por ejemplo div, section, article o dialog). No aplicar directamente a elementos reemplazados o sin hijos como img, input o canvas: envolverlos en un div. Si el popup tiene scroll interno, aplicar la clase al marco exterior no desplazable.

No hace falta crear el canvas ni llamar funciones. Se detectan también popups agregados dinámicamente. La nieve se ajusta al tamaño del elemento, respeta sus bordes redondeados y no captura clics, toques o foco. Si la posición es static se agrega position:relative mediante un atributo temporal. Al ocultar, cerrar, eliminar o retirar la clase se detiene el efecto y se liberan el canvas y los sensores. Si se abre nuevamente, se reinicia. También se respeta prefers-reduced-motion.

## Opciones

- `data-snow-density="0.7"`: multiplicador de densidad, por defecto 1 (rango 0.1–3).
- `data-snow-tilt="false"`: desactiva la inclinación del dispositivo.
- `style="--snow-z-index: 5"`: nivel del canvas respecto a los hijos del contenedor.

La nieve funciona sin sensores, incluso desde file://. Los sensores requieren contexto seguro y soporte del navegador; en dispositivos que requieren permiso explícito, invocar `SnowEffect.requestMotion(elemento)` desde un clic. No se solicitan permisos automáticamente. Si no hay sensores disponibles, la nieve cae verticalmente.

## API opcional

```js
const popup = document.querySelector("#popup");
SnowEffect.mount(popup);   // agrega la clase
SnowEffect.unmount(popup); // quita la clase y libera recursos
SnowEffect.refresh();      // reevaluación explícita (normalmente innecesaria)
```

`demo.html` muestra un popup nativo que puede abrirse y cerrarse, sin servidor. La opción de inclinación utiliza una interacción explícita para solicitar permiso.
