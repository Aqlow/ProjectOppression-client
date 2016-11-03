module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    'create-windows-installer': {
      x64: {
        appDirectory: '/home/aqlow/ElectronWorkspace/ProjectOppression/build/projoppr-win32-x64/',
        outputDirectory: '/home/aqlow/ElectronWorkspace/ProjectOppression/release/projoppr-win64/',
        authors: 'aqlow',
        exe: 'projoppr.exe'
      },
      ia32: {
        appDirectory: '/home/aqlow/ElectronWorkspace/ProjectOppression/build/projoppr-win32-ia32/',
        outputDirectory: '/home/aqlow/ElectronWorkspace/ProjectOppression/release/projoppr-win32/',
        authors: 'aqlow',
        exe: 'projoppr.exe'
      }
    }
  });

  // Load the plugin that provides the "uglify" task.
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-electron-installer')

  // Default task(s).
  grunt.registerTask('default', ['uglify']);


};
