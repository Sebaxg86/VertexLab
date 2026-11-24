"""Generate a per-user MSI payload from the published Windows applications."""
from pathlib import Path
import hashlib
import sys
import argparse
import xml.etree.ElementTree as E
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,default=root/'artifacts')
output=parser.parse_args().output.resolve()
source=output/'app'
ns='http://wixtoolset.org/schemas/v4/wxs'
E.register_namespace('',ns)
def add(parent,tag,**attrs):return E.SubElement(parent,'{'+ns+'}'+tag,attrs)
wix=E.Element('{'+ns+'}Wix')
package=add(wix,'Package',Name='VertexLab Desktop Preview',Manufacturer='VertexLab',Version='0.3.2',UpgradeCode='B0296852-545A-4584-8F41-576D09FFBF67',Scope='perUser')
add(package,'MajorUpgrade',DowngradeErrorMessage='Ya está instalada una versión más reciente de VertexLab.')
add(package,'MediaTemplate',EmbedCab='yes',CompressionLevel='high')
add(package,'Property',Id='ARPNOMODIFY',Value='1')
base=add(package,'StandardDirectory',Id='LocalAppDataFolder')
programs=add(base,'Directory',Id='VertexPrograms',Name='Programs')
install=add(programs,'Directory',Id='INSTALLFOLDER',Name='VertexLab')
feature=add(package,'Feature',Id='Main',Title='VertexLab Desktop',Level='1')
dirs={Path('.'):install}
for file in sorted(source.rglob('*')):
 if not file.is_file() or file.suffix=='.pdb':continue
 relative=file.relative_to(source)
 current=Path('.')
 for part in relative.parent.parts:
  previous=current;current=current/part
  if current not in dirs:dirs[current]=add(dirs[previous],'Directory',Id='d'+hashlib.sha256(str(current).encode()).hexdigest()[:20],Name=part)
 ident=hashlib.sha256(relative.as_posix().encode()).hexdigest()[:24]
 component=add(dirs[current],'Component',Id='c'+ident,Guid='*')
 file_id='DesktopExecutable' if relative.as_posix()=='VertexLab.Desktop.exe' else 'f'+ident
 add(component,'File',Id=file_id,Source=str(file),KeyPath='yes')
 if file_id=='DesktopExecutable':
  prog=add(component,'ProgId',Id='VertexLab.PortableSession',Description='Sesión portable de VertexLab')
  ext=add(prog,'Extension',Id='vrtx',ContentType='application/vnd.vertexlab.session+zip')
  add(ext,'Verb',Id='open',Command='Abrir en VertexLab',TargetFile=file_id,Argument='"%1"')
 add(feature,'ComponentRef',Id='c'+ident)
menu=add(package,'StandardDirectory',Id='ProgramMenuFolder')
appmenu=add(menu,'Directory',Id='VertexLabMenu',Name='VertexLab')
shortcut=add(appmenu,'Component',Id='ApplicationShortcuts',Guid='*')
add(shortcut,'Shortcut',Id='DesktopShortcut',Name='VertexLab Desktop',Target='[#DesktopExecutable]',WorkingDirectory='INSTALLFOLDER')
add(shortcut,'RemoveFolder',Id='RemoveMenu',On='uninstall')
add(shortcut,'RegistryValue',Root='HKCU',Key=r'Software\VertexLab',Name='DesktopInstalled',Type='integer',Value='1',KeyPath='yes')
add(feature,'ComponentRef',Id='ApplicationShortcuts')
E.indent(wix)
E.ElementTree(wix).write(output/'VertexLab.wxs',encoding='utf-8',xml_declaration=True)
