# China Reventas

## Resumen

La pestaña **Resumen** separa el estado general, las ganancias netas históricas y el reparto por pedido. En cada pedido, el fondo de capital se distribuye según los aportes registrados; el fondo de trabajo conserva la proporción de puntos. Los gastos generales se prorratean según las ventas de cada pedido para conciliar el detalle con la utilidad histórica. Si hay pedidos con pérdida, reducen la ganancia antes del reparto. Los montos son estimados: la aplicación no registra si cada socio retiró o reinvirtió su parte.

## Historial privado de cambios

El historial se genera en Cloud Functions cuando se crean, editan o eliminan documentos de ventas, pedidos, gastos, productos, socios, aportes, tareas o configuración. La función conserva los campos que cambiaron y la identidad de Firebase Auth; la colección `auditLogs` no es legible ni modificable desde el navegador. El historial empieza al desplegar las funciones y no reconstruye cambios anteriores.

El historial admite un único administrador: el correo verificado de Firebase Auth configurado en el parámetro `AUDIT_ADMIN_EMAIL`. Solo la función del servidor consulta `auditLogs`; las reglas de Firestore deniegan el acceso directo. Que el sitio y el repositorio de GitHub Pages sean públicos no publica el contenido del historial, siempre que se desplieguen estas funciones y reglas. No subas archivos `functions/.env*` al repositorio.

Las ventas cuyo costo no pueda identificarse se calculan temporalmente con margen cero y bloquean el reparto hasta corregirlas. La aplicación avisa en las vistas de resumen; vincula la venta con un producto o pedido para reflejar su costo real.

## Despliegue

1. Verifica que el proyecto tenga habilitada la facturación requerida por Cloud Functions. Instala Firebase CLI e inicia sesión con una cuenta con permisos para desplegar Cloud Functions y Firestore Rules.
2. Desde esta carpeta, ejecuta `firebase deploy --only functions,firestore:rules --project ventas-65b19`.
3. Cuando Firebase solicite `AUDIT_ADMIN_EMAIL`, ingresa únicamente tu correo verificado de Firebase Auth y asegúrate de que sea el correo autorizado para usar la aplicación. No uses listas ni correos compartidos.
4. Publica `index.html` y `order-distribution.js` juntos en el repositorio que sirve GitHub Pages y espera a que Pages complete la publicación.

GitHub Pages solo publica la interfaz; no despliega Cloud Functions ni reglas. El código de `firestore.rules` y el Firebase Web API key pueden ser públicos: el control real de los datos son las reglas desplegadas y la autorización del servidor. Ten presente que las direcciones de correo incluidas en `firestore.rules` también son visibles en el repositorio público.

Para validar el registro y los cálculos por pedido: `cd functions; npm test`.
