// Fireworks Animation Logic
function triggerFireworks() {
  const duration = 3 * 1000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  const interval = setInterval(function() {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 50 * (timeLeft / duration);
    // ใช้ canvas-confetti หากมี หรือแสดงผลผ่าน CSS/JS ธรรมดา
    // เพื่อให้ทำงานได้ชัวร์ ผมจะสร้าง DOM element สำหรับพลุไฟแทน
    console.log("Fireworks triggered!");
  }, 250);
}
