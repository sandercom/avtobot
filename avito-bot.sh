#!/bin/bash

# Имена процессов
BOT_NAME="avito-bot"
CRON_NAME="avito-cron"

# Пути к файлам
BOT_PATH="bot/index.js"
CRON_PATH="cron/job.js"

case "$1" in
  start)
    echo "Запуск $BOT_NAME и $CRON_NAME..."
    pm2 start "$BOT_PATH" --name "$BOT_NAME"
    pm2 start "$CRON_PATH" --name "$CRON_NAME"
    pm2 save
    ;;
  stop)
    echo "Остановка $BOT_NAME и $CRON_NAME..."
    pm2 stop "$BOT_NAME"
    pm2 stop "$CRON_NAME"
    pm2 save
    ;;
  restart)
    echo "Перезапуск $BOT_NAME и $CRON_NAME..."
    pm2 restart "$BOT_NAME"
    pm2 restart "$CRON_NAME"
    pm2 save
    ;;
  status)
    pm2 list
    ;;
  logs)
    pm2 logs
    ;;
  enable-autostart)
    echo "Настройка автозапуска PM2 при старте системы..."

    # Настройка systemd с текущим пользователем
    OUTPUT=$(pm2 startup systemd -u $(whoami) --hp $HOME 2>&1)
    echo "$OUTPUT"

    # Если есть команда с sudo, выполним её
    CMD=$(echo "$OUTPUT" | grep -oP '(?<=\[PM2\] To setup the Startup Script, copy/paste the following command:\n).*' | grep sudo)

    if [ -n "$CMD" ]; then
      echo "Выполняется команда:"
      echo "$CMD"
      eval "$CMD"
    fi

    # Сохраняем текущие процессы
    pm2 save

    echo "Автозапуск успешно настроен для пользователя $(whoami)."
    ;;
  *)
    echo "Использование: $0 {start|stop|restart|status|logs|enable-autostart}"
    exit 1
    ;;
esac

exit 0
