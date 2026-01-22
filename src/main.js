import Start from './scenes/Start.js';

const config = {
  type: Phaser.AUTO,
  width: 1000,
  height: 800,
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  },
  scene: [Start]
};

new Phaser.Game(config);
