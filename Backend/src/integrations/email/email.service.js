const outbox = [];

async function send(message) {
  outbox.push({ ...message, sentAt: new Date() });
  if (process.env.NODE_ENV !== 'test' && process.env.EMAIL_PROVIDER === 'console') {
    process.stdout.write(`Email queued for ${message.to}: ${message.subject}\n`);
  }
  return { accepted: true };
}

function getOutbox() { return [...outbox]; }
function clearOutbox() { outbox.length = 0; }
module.exports = { send, getOutbox, clearOutbox };
