# Seguridad de Nebulix

Si encuentras un fallo de seguridad (acceso a cuentas ajenas, saltarse permisos, robar monedas, ejecutar código en el servidor, etc.):

1. **No lo publiques** en un issue, en la comunidad ni en redes.
2. Avisa en privado desde la pestaña **Security → Report a vulnerability** de este repositorio (GitHub Private Vulnerability Reporting).
3. Incluye los pasos para reproducirlo y qué podría conseguir un atacante.

Se responderá lo antes posible y se te dará crédito en las notas de la versión si quieres.

## Qué no es un fallo

- Ataques de denegación de servicio por volumen o que requieran acceso físico al dispositivo de la víctima.

## Buenas prácticas para quien despliegue su propio servidor

- Usa direcciones distintas para `APP_ORIGIN`, `PROXY_ORIGIN` y `GAMES_ORIGIN`.
- Haz copias de seguridad de `DATA_DIR`.
